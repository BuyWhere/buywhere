#!/usr/bin/env node
/**
 * update-sitemap-lastmod.mjs — Rewrite sitemap <lastmod> for the daily queue.
 *
 * Reads content/audits/midnight-indexing-queue-{date}.json (produced by
 * generate-indexing-queue.mjs) and writes:
 *
 *   content/audits/sitemap-lastmod-override-{date}.json
 *     { date, lastmod, urls, source }
 *     The Next.js sitemap route (src/lib/sitemaps.ts) reads the latest
 *     override file and replaces <lastmod> on each matching <url> entry.
 *     When Googlebot re-fetches the sitemap it sees a newer lastmod for
 *     these URLs and re-crawls them — that's the indexing signal.
 *
 *   content/audits/sitemap-lastmod-audit-{date}.json
 *     { date, queue_size, override_path, audit_path, generated_at }
 *     Evidence file used by BUY-72089 acceptance ("audit JSON exists for
 *     the first post-wire run").
 *
 * Indexing API has been DROPPED (BUY-66696) — Google's Indexing API only
 * accepts JobPosting / BroadcastEvent, not product URLs. Sitemap freshness
 * is the canonical Google-supported path for general web pages.
 *
 * Usage:
 *   node scripts/update-sitemap-lastmod.mjs                 # uses today UTC
 *   node scripts/update-sitemap-lastmod.mjs 2026-08-20      # explicit date
 *
 * Environment:
 *   OVERRIDE_LASTMOD        — ISO timestamp; defaults to now (UTC)
 *   AUDITS_DIR              — override default "content/audits"
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const AUDITS_DIR = path.resolve(
  process.env.AUDITS_DIR || path.join(REPO_ROOT, "content", "audits")
);
const SITE_ORIGIN = "https://buywhere.ai";

function utcDateString(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function isoUtc(date = new Date()) {
  return date.toISOString();
}

function pickDateArg(argv) {
  for (const arg of argv.slice(2)) {
    if (!arg.startsWith("--") && !arg.startsWith("-")) return arg;
  }
  return utcDateString();
}

async function readJson(filePath) {
  const body = await fs.readFile(filePath, "utf8");
  return JSON.parse(body);
}

async function readQueue(auditsDir, date) {
  const queuePath = path.join(auditsDir, `midnight-indexing-queue-${date}.json`);
  try {
    const json = await readJson(queuePath);
    if (Array.isArray(json?.urls)) return { urls: json.urls, path: queuePath, raw: json };
    if (Array.isArray(json)) return { urls: json, path: queuePath, raw: { urls: json } };
    return { urls: [], path: queuePath, raw: json };
  } catch (error) {
    if (error?.code === "ENOENT") return { urls: [], path: queuePath, raw: null, missing: true };
    throw error;
  }
}

function floorToSecondIso(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return null;
  return new Date(Math.floor(ms / 1000) * 1000).toISOString();
}

function normalizeUrl(rawUrl) {
  if (typeof rawUrl !== "string") return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  // Accept both canonical BuyWhere URLs and relative paths; collapse to the
  // sitemap-emitted form (origin + canonical path, no trailing slash).
  try {
    const parsed = new URL(trimmed, SITE_ORIGIN);
    parsed.hash = "";
    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }
    return `${parsed.protocol}//${parsed.host}${pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

async function main() {
  const date = pickDateArg(process.argv);
  const lastmod = process.env.OVERRIDE_LASTMOD || isoUtc(new Date());

  const { urls: rawUrls, path: queuePath, missing, raw } = await readQueue(AUDITS_DIR, date);

  if (missing) {
    console.error(
      `Queue file not found for ${date}: ${queuePath}. Run generate-indexing-queue.mjs first.`,
    );
    process.exit(1);
  }

  const lastmodByUrl = new Map();
  if (Array.isArray(raw?.entries)) {
    for (const e of raw.entries) {
      if (!e || typeof e !== "object") continue;
      const norm = normalizeUrl(e.url);
      const iso = floorToSecondIso(e.lastModified);
      if (norm && iso) lastmodByUrl.set(norm, iso);
    }
  }

  const seen = new Set();
  const urls = [];
  for (const u of rawUrls) {
    const norm = normalizeUrl(u);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    urls.push(norm);
  }

  const overridePath = path.join(AUDITS_DIR, `sitemap-lastmod-override-${date}.json`);
  const recentPath = path.join(AUDITS_DIR, `sitemap-products-recent-${date}.json`);
  const auditPath = path.join(AUDITS_DIR, `sitemap-lastmod-audit-${date}.json`);
  const generatedAt = isoUtc(new Date());

  await fs.mkdir(AUDITS_DIR, { recursive: true });

  const overridePayload = {
    date,
    lastmod,
    source: "midnight-indexing-queue",
    generated_at: generatedAt,
    urls,
  };

  // Sidecar: emit the recent-products slice in the SAME shape that
  // src/lib/sitemaps.ts emits entries. The sitemap route appends these
  // entries to its existing /v1/products-dervived list. Each entry uses
  // `lastmod` (today) as its <lastmod>; the override mechanism later in
  // sitemaps.ts can pin this further if a future override file takes
  // precedence. (BUY-63866 / BUY-72089)
  const recentPayload = {
    date,
    lastmod,
    generated_at: generatedAt,
    source_queue: path.relative(REPO_ROOT, queuePath),
    entries: urls.map((url) => ({
      url,
      // Per-URL catalog lastmod when the queue recorded one; omit otherwise
      // (BUY-79729 — do not stamp OVERRIDE_LASTMOD onto 500 product URLs).
      lastModified: lastmodByUrl.get(url),
      changeFrequency: "weekly",
      priority: 0.7,
    })),
  };

  const auditPayload = {
    date,
    queue_size: rawUrls.length,
    override_size: urls.length,
    override_path: path.relative(REPO_ROOT, overridePath),
    recent_path: path.relative(REPO_ROOT, recentPath),
    audit_path: path.relative(REPO_ROOT, auditPath),
    generated_at: generatedAt,
    lastmod,
    queue_path: path.relative(REPO_ROOT, queuePath),
  };

  await fs.writeFile(overridePath, JSON.stringify(overridePayload, null, 2));
  await fs.writeFile(recentPath, JSON.stringify(recentPayload, null, 2));
  await fs.writeFile(auditPath, JSON.stringify(auditPayload, null, 2));

  console.log(
    `Wrote ${urls.length} override URL(s) to ${path.relative(REPO_ROOT, overridePath)}`,
  );
  console.log(`Wrote ${urls.length} recent-product entries to ${path.relative(REPO_ROOT, recentPath)}`);
  console.log(`Audit: ${path.relative(REPO_ROOT, auditPath)}`);
  console.log(`lastmod: ${lastmod}`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});