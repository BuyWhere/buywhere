<!--
§7 PR template — Indexation Directive 2026-08-25 (P0 standing).
Every PR touching routes, content, sitemaps, or middleware MUST complete this checklist
before merge. 4seen runs an independent 6-hourly guard; this template makes the same
checks happen at PR time. Link the canonical directive in your PR body:
  https://github.com/BuyWhere/buywhere/blob/main/DIRECTIVE-indexation-2026-08-25.md
-->

## Summary

<!-- One-paragraph description of what this PR does and why. -->

## Ticket

- BUY-#### (or other ticket): <!-- link -->

## Scope

- [ ] Branch is current with `origin/main` (`git pull --rebase origin main` was clean — see rule 2)
- [ ] `bash scripts/check-commit-scope.sh` reports **PASS** locally (committed and pushed, see below)
- [ ] No deletions under `content/`, `src/app/`, `src/middleware.ts`, `src/lib/sitemaps.ts`, `.github/` (rule 2)
- [ ] This PR touches ≤ **25 files** in total (rule 2 — anything more is a stale-tree smell)
- [ ] If this PR renames or deletes a published URL: rule 3 says **STOP** and get Richmond's written approval on the ticket before pushing

## §7 Verification evidence (REQUIRED for any PR touching routes / content / sitemaps / middleware)

> Skip this block ONLY if the PR does not touch any of: `src/app/**`, `content/**`,
> `src/middleware.ts`, `src/lib/sitemaps.ts`, `public/sitemap*.xml`, `robots.txt`,
> canonical/`noindex` headers, or `next.config.*`.

- [ ] **Sitemap counts before → after**, per child (`sitemap-blog.xml`, `sitemap-compare.xml`,
      `sitemap-pages.xml`, `sitemap-products.xml`, `sitemap-others.xml`, etc.). Paste output:

  ```
  paste: aeo-publish-verify.sh snapshot   ->   before.counts
  paste: aeo-publish-verify.sh verify     ->   after.counts + RESULT
  ```

- [ ] **200-probe**: every URL in `sitemap-blog.xml` probed, plus every NEW URL and a 10% sample
      of each other child sitemap. Paste `RESULT: PASS` line from the verifier (any non-200 is a fail).
- [ ] **`git diff --stat origin/main~1..HEAD`** shows the change touched only in-scope files
      (paste in a comment on the ticket — a screenshot is fine if too long).

> If any sitemap child count **decreased**, do not merge: revert and escalate per §7.

## SEO-GATE block (REQUIRED if the PR touches any FROZEN surface)

> FROZEN surfaces per directive §3: `src/middleware.ts` (blog/410/redirect blocks),
> `src/lib/sitemaps.ts`, `src/app/sitemap-*.xml/`, `robots.txt`, `next.config` headers,
> canonical logic, `noindex` logic. The PR title MUST start with `SEO-GATE:` and have
> Richmond's written approval on the ticket before merge.

- [ ] PR title begins with `SEO-GATE:`
- [ ] Richmond's approval comment is linked on the ticket (rule 9)

## Freshness / lastmod sanity (for any PR touching a sitemap or a page route)

- [ ] No fake `lastmod`/`dateModified` set to `new Date()` (rule 5)
- [ ] `lastmod` only changes when the rendered HTML hash actually changed (rule 5, §5 of directive)

## Templates and doorway pages

- [ ] No new category-pair (`/compare/<cat>-vs-<cat>`) pages (rule 6, §6)
- [ ] Any new `/compare/*` page meets the §6 minimum bar: ≥3 retailers, ≥8 differentiating
      attributes, ≥300 words unique editorial, 3–5 FAQs visible + `FAQPage` schema,
      `Product`+`ItemList` structured data, and inbound links from ≥2 indexed pages **before**
      it enters a sitemap
- [ ] No new page enters a sitemap unless at least two existing indexed pages already link to it (rule 7)
- [ ] No non-200 URL is added to any sitemap (rule 8)

## Verification commands run locally

- [ ] `bash scripts/check-commit-scope.sh` → PASS
- [ ] (if applicable) `aeo-publish-verify.sh snapshot` recorded **before** push
- [ ] (post-deploy) `aeo-publish-verify.sh verify` → `RESULT: PASS` posted on the deploy ticket

## Risks / rollback

- [ ] Rollback plan stated (revert commit hash or `git revert <sha>`)
- [ ] No data loss or 410s introduced (rule 4 — use 301, not 410, for content retirement)

---

**Reminder:** This template is the in-repo §7 guard. The independent 4seen guard runs every
6 hours and will catch anything you missed; every catch is logged against the committing agent.
Don't skip steps because the guard exists — it's there to catch what you missed, not to excuse
you from checking.