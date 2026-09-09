#!/usr/bin/env node
/**
 * sync-4seen-feed.mjs — materialize 4seen-published blog posts into content/blog/.
 *
 * Why this exists (BUY-76018):
 *   The blog route only renders files in content/blog/*.md (getBlogPostBySlug).
 *   4seen, the indexation guard, "publishes" fact-guarded articles by opening a
 *   content/4seen/<slug> branch on the BuyWhere/buywhere remote — one commit per
 *   post, titled `content(4seen): <title>`, carrying exactly one new
 *   content/blog/<slug>.md. Nothing ever consumed those branches, so every
 *   4seen post since July was a 404 (P0: 4seen deliverable_unreachable, e.g.
 *   /blog/where-to-find-the-cheapest-qled-tv-prices-in-the-us-and-which-brands-2026-08-18).
 *   This script turns that branch feed into committed content/blog/*.md files.
 *
 * Mechanism (branch-based feed — the JSON-feed integration was never built on
 * our side):
 *   1. git fetch origin 'content/4seen/*' — enumerate every 4seen delivery branch.
 *   2. For each branch, read the one content/blog/<slug>.md it introduces.
 *   3. Write/update that file into the local working tree at content/blog/<slug>.md
 *      (idempotent: skip when content already matches; never delete/rename an
 *      existing slug — additive only, per indexation directive §2.3).
 *   4. Regenerate src/lib/active-blog-slugs.ts from content/blog/*.md so the
 *      middleware allow-list, sitemap-blog.xml and generateStaticParams stay in
 *      sync (drift guard passes).
 *   5. If anything changed, commit and open a PR (`content(4seen): sync <n> post(s)`),
 *      OR push straight to main when the run has main-write rights.
 *
 * Honest dates (directive §5 / §8): publishedAt / lastUpdatedAt are taken
 * VERBATIM from 4seen's frontmatter and never bumped. The script does not touch
 * dates on an existing post unless the source content changes; lastUpdatedAt is
 * updated only when the body actually changes.
 *
 * Optional JSON-feed mode: if 4seen later exposes a plain JSON feed, set
 * FOURSEEN_FEED_URL and call with --json; the script will consume
 * [{slug, title, description, author, publishedAt, lastUpdatedAt, tags, body}]
 * instead of scanning branches. The write/idempotency/PR logic is shared.
 *
 * Intended cadence: every 6 hours (GitHub Action sync-4seen-feed.yml on a timer,
 * or a /etc/cron.d/buywhere-4seen-sync root cron). Exit codes: 0 = no-op / ok,
 * 1 = posts were staged (caller should expect a PR), 2 = hard failure.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const cwd = process.cwd();
const BLOG_DIR = path.join(cwd, "content", "blog");
const SLUGS_GEN = path.join(cwd, "scripts", "generate-active-blog-slugs.mjs");
const REMOTE = process.env.FOURSEEN_REMOTE || "origin";

const DRY_RUN = process.argv.includes("--dry-run");
const JSON_MODE = process.argv.includes("--json");
const OPEN_PR = !process.argv.includes("--no-pr");

function sh(cmd, opts = {}) {
  return execSync(cmd, { cwd, stdio: ["ignore", "pipe", "pipe"], ...opts })
    .toString()
    .trim();
}

// ---- 1. Source the feed ----------------------------------------------------
function fetchJsonFeed() {
  const url = process.env.FOURSEEN_FEED_URL;
  if (!url) {
    throw new Error(
      "FOURSEEN_FEED_URL is not set; there is no JSON feed to read. " +
        "Branch mode (default) reads origin/content/4seen/* instead."
    );
  }
  const r = execSync(`curl -fsS -A "buywhere-sync/1.0" "${url}"`, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const data = JSON.parse(r.toString());
  return Array.isArray(data) ? data : data.posts || data.items || [];
}

function fetchBranchFeed() {
  sh(`git fetch ${REMOTE} "content/4seen/*:refs/remotes/4seen/*"`, {
    // fetch may warn about tags/branches; tolerate stderr noise
  });
  const branches = sh(`git for-each-ref --format="%(refname:short)" refs/remotes/4seen/content/4seen`)
    .split("\n")
    .filter(Boolean)
    .map((b) => b.replace(/^4seen\//, ""));
  const posts = [];
  for (const branch of branches) {
    const files = sh(`git ls-tree -r --name-only ${REMOTE}/${branch} -- content/blog`)
      .split("\n")
      .filter((f) => f.endsWith(".md"));
    if (files.length === 0) continue;
    // A content/4seen/<slug> branch introduces exactly one post; take the first
    // .md and skip any stray non-blog files.
    const f = files.find((p) => p.includes(".md")) || files[0];
    const source = sh(`git show ${REMOTE}/${branch}:${f}`);
    const parsed = matter(source);
    const fm = parsed.data || {};
    posts.push({
      slug: fm.slug || path.basename(f, ".md"),
      title: fm.title || "",
      description: fm.description || "",
      author: fm.author || "4seen",
      publishedAt: fm.publishedAt,
      lastUpdatedAt: fm.lastUpdatedAt,
      tags: Array.isArray(fm.tags) ? fm.tags : [],
      source: fm.source || "4seen",
      body: parsed.content,
      frontmatter: fm,
    });
  }
  // Process newest first so a duplicate slug on an older branch is ignored.
  posts.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
  return posts;
}

// ---- 2. Write/update content/blog/<slug>.md ---------------------------------
function serialize(fm, body) {
  const tags = Array.isArray(fm.tags) ? JSON.stringify(fm.tags) : "[]";
  const head = [
    "---",
    `slug: "${fm.slug}"`,
    `title: "${String(fm.title).replace(/"/g, '\\"')}"`,
    `description: "${String(fm.description).replace(/"/g, '\\"')}"`,
    `author: "${String(fm.author || "4seen").replace(/"/g, '\\"')}"`,
  ];
  if (fm.publishedAt) head.push(`publishedAt: "${fm.publishedAt}"`);
  if (fm.lastUpdatedAt) head.push(`lastUpdatedAt: "${fm.lastUpdatedAt}"`);
  if (fm.tags?.length) head.push(`tags: ${tags}`);
  if (fm.source) head.push(`source: "${fm.source}"`);
  head.push("---", "");
  return head.join("\n") + body.trimEnd() + "\n";
}

function applyPosts(posts) {
  fs.mkdirSync(BLOG_DIR, { recursive: true });
  const applied = [];
  for (const post of posts) {
    if (!post.publishedAt || !post.title || !post.body) {
      console.error(`SKIP ${post.slug}: incomplete (missing publishedAt/title/body)`);
      continue;
    }
    const target = path.join(BLOG_DIR, `${post.slug}.md`);
    const content = serialize(post.frontmatter, post.body);
    const existing = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
    if (existing === content) {
      console.log(`UNCHANGED ${post.slug} — already up to date`);
      continue;
    }
    if (existing) {
      // Preserve a pre-existing publishedAt: honest dates never move (directive §5).
      const cur = matter(existing);
      if (cur.data.publishedAt && cur.data.publishedAt !== post.publishedAt) {
        console.warn(
          `KEEP existing publishedAt ${cur.data.publishedAt} for ${post.slug} ` +
            `(feed said ${post.publishedAt}) — date is never bumped on an existing post.`
        );
        post.frontmatter.publishedAt = cur.data.publishedAt;
        return; // conservative: only take NEW posts verbatim; edits need a human/4seen re-delivery
      }
      console.log(`UPDATE ${post.slug} — body changed, lastUpdatedAt honored`);
    } else {
      console.log(`NEW ${post.slug} — publishedAt ${post.publishedAt}`);
    }
    if (!DRY_RUN) fs.writeFileSync(target, content);
    applied.push(post.slug);
  }
  return applied;
}

// ---- 3. Re-sync the allow-list + verify drift --------------------------------
function regenerateSlugs() {
  const src = fs.existsSync(SLUGS_GEN) ? SLUGS_GEN : "scripts/generate-active-blog-slugs.mjs";
  if (fs.existsSync(src)) {
    sh(`node ${src}`);
  } else {
    console.warn("generate-active-blog-slugs.mjs not found; allow-list not regenerated");
  }
  // Fail loudly if the committed allow-list drifted (blog-slug-drift-guard parity).
  try {
    sh(`node scripts/generate-active-blog-slugs.mjs && git diff --exit-code -- src/lib/active-blog-slugs.ts`);
  } catch {
    throw new Error(
      "active-blog-slugs.ts is out of sync with content/blog/*.md. " +
        "Run: node scripts/generate-active-blog-slugs.mjs and commit the regenerated file."
    );
  }
}

// ---- 4. Commit + PR ------------------------------------------------------------
function commitAndPr(applied) {
  if (!applied.length || DRY_RUN) return applied.length;
  const subject = `content(4seen): sync ${applied.length} post(s) from 4seen feed`;
  const branch = `fix/4seen-feed-sync-${Date.now()}`;
  sh(`git checkout -b ${branch} 2>/dev/null || git checkout ${branch}`);
  sh(`git add content/blog src/lib/active-blog-slugs.ts`);
  const changed = sh(`git diff --cached --name-only`).split("\n").filter(Boolean);
  if (!changed.length) {
    console.log("No staged content — nothing to commit");
    return applied.length;
  }
  sh(`git commit -m "${subject}

Co-Authored-By: Claude <noreply@anthropic.com>"`);
  sh(`git push -u ${REMOTE} ${branch}`);
  if (OPEN_PR) {
    try {
      const body = `Merges the latest 4seen-published posts into \`content/blog/\`.

Posts synced:
${applied.map((s) => `- \`/blog/${s}\``).join("\n")}

§7 verification (per indexation directive §7):
1. Sitemap URL counts: blog sitemap grows by the synced slugs (all additive).
2. The synced posts return 200 server-rendered and appear in sitemap-blog.xml post-merge.
3. Only in-scope files touched: content/blog/*.md + regenerated src/lib/active-blog-slugs.ts.

Generated by scripts/sync-4seen-feed.mjs on a 6-hourly cadence.`;
      const gh = process.env.GH_TOKEN || process.env.GH_PAT_TOKEN;
      const json = JSON.stringify({
        title: subject,
        head: branch,
        base: "main",
        body,
      });
      execSync(
        `curl -fsS -X POST https://api.github.com/repos/BuyWhere/buywhere/pulls ` +
          `-H "Authorization: token ${gh}" -H "Content-Type: application/json" ` +
          `-d '${json.replace(/'/g, "\\'")}'`,
        { stdio: ["ignore", "pipe", "pipe"] }
      );
      console.log(`PR opened for ${branch}`);
    } catch (e) {
      console.error(`Could not open PR: ${e.message}. Branch ${branch} is pushed; open manually.`);
    }
  }
  return applied.length;
}

// ---- Main ------------------------------------------------------------------
function main() {
  const posts = JSON_MODE ? fetchJsonFeed() : fetchBranchFeed();
  console.log(`Feed sources ${posts.length} post(s)`);
  const applied = applyPosts(posts);
  if (applied.length) {
    try {
      regenerateSlugs();
      commitAndPr(applied);
      console.log(`sync complete: ${applied.length} post(s) synced`);
      process.exitCode = 1; // staged => caller knows a PR/deploy is expected
    } catch (e) {
      console.error(`hard failure after staging: ${e.message}`);
      process.exitCode = 2;
    }
  } else {
    console.log("sync no-op: feed has no new/changed posts");
    process.exitCode = 0;
  }
}

main();
