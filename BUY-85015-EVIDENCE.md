# BUY-85015: Fix Evidence — FINAL (Crew, 2026-10-03)

## Issue
Homepage hero search bar UX: (1) nested double-border input group on desktop,
(2) header/body x-misalignment, (3) search-card title line-count inconsistency.

## Status: FIXED + DEPLOYED + PROD-VERIFIED

### 1) Double-border (already on main before this heartbeat)
Commit `9ba94d567` — removed `ring-1 ring-black/5` from outer card and
`border border-slate-200` from search input + country select.
Prod re-check 2026-10-03: classes absent from live HTML.

### 2) Header/body alignment (this heartbeat)
Commits on main:
- `c9848db0081b4d9852d81f2d9fd879e5a3b13fdc` — page.tsx body sections + Footer + NewsletterBanner + AgentMarketingBlock → `max-w-7xl … lg:px-8`
- `47ca9e95c20661ff78f6d8872f60b57dcd730d27` — TrustLayer + PopularComparisons (hero + footer variants) → 7xl

Root cause: Nav/header and hero already 7xl; body/chrome still 6xl.

Prod verify: homepage max-w-7xl × 29 / max-w-6xl × 0; header inner = `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8`.

### 3) Search-card titles (this heartbeat)
Commit `c9848db0` — `SearchResultsClient.tsx` card `<h2>` gains `min-h-[2.75rem]`
(two-line reserve at text-base × leading-snug) so 1-line titles no longer
collapse the block and leave uneven gaps in the xl 4-col grid.

Prod verify `/search?q=laptop&country=sg`: 14/14 cards carry the class.

## CI / Deploy evidence
- deploy-www 37097003948 (c9848db0): success, smoke test success
- deploy-www 37097512928 (47ca9e95): success
- Guards (search-blocklist, blog-slug-drift, indexation-§7, supervisor): success on both SHAs

## Definition of done checklist
1. Pushed to main ✓ (c9848db0, 47ca9e95)
2. deploy-www succeeded + Railway swapped ✓
3. CI green ✓
4. Prod-verified via curl HTML ✓ (counts in heartbeat-evidence/BUY-85015-CREW-20261003.md)
5. Schema changes: none ✓

## Control-plane write blocker
Paperclip issue comment + status PATCH returned
`403 cross_issue_influence_run_context_required` despite `X-Paperclip-Run-Id`
and body-embedded runId. Same failure class as 2026-10-02 heartbeat.
Intended disposition on the issue: **done**.
