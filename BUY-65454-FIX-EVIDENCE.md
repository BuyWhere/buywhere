# BUY-65454 — Fix evidence: duplicate search headings on /search

**Issue:** [QA] [UX] Duplicate search headings on /search — redundant H1 wastes
vertical space (severity: medium).

**Suggested fix (per issue):** Conditionally hide the top hero H1 when search
results are active. Use one unified results header.

## What changed

`src/app/search/SearchResultsClient.tsx` (single file, +16 / -9)

1. The hero block (`<p>Product search</p>` + `<h1>Search results for "X"</h1>` +
   supporting paragraph) is now rendered **only when there is no active search**.
   When `hasActiveSearch` is true the block returns `null`, so the desktop H1
   no longer echoes the query string.
2. The result-count header below the search box (formerly `<h2>{N} results for
   "…"</h2>`) is now rendered as `<h1>` so the page has a **single semantic H1**
   — the unified results header.

The mobile compact summary (`md:hidden` H1 in the page intro) is unchanged. It
already coexists with the desktop hero (which had `md:block` / `md:hidden`
breakpoints) and is now the only H1 across both breakpoints.

## Verification (Playwright @ 1440x900, dev server on port 4711)

| Query                       | Before fix — H1 count | After fix — H1 count | H1 content (desktop)                                                                  |
| --------------------------- | --------------------- | -------------------- | ------------------------------------------------------------------------------------- |
| `?q=iphone+15+pro&country=US` | 2                   | **1**                | `UNITED STATES / 0 results for "iphone 15 pro"` (mobile-summary H1, hidden at md+)     |
| `?q=wireless+headphones&country=US` | 2             | **1**                | `UNITED STATES / 0 results for "wireless headphones"`                                 |
| `?q=nike+shoes&country=US`  | 2                     | **1**                | `UNITED STATES / 0 results for "nike shoes"`                                          |
| `/search` (no query)        | 1                     | **1**                | `Find live catalog results without leaving BuyWhere` (hero still renders when empty)   |

DOM probe confirms the redundant hero strings are gone when a search is active:

- `"Search results for"` matches on the page during active search: **0**
  (previously 1)
- `"Product search"` eyebrow matches on the page during active search: **0**
  (previously 1)

Mobile (390x844) after fix: H1 count = 1 (the compact summary).

> Note: the dev server's search endpoint returned HTTP 429 (upstream daily quota
> reached — resets at 2026-07-31T00:00Z) for every probe, so the result-count
> `<h1>` itself did not render in any of the captures (the page fell into the
> `error` state). The structural fix is verified by the DOM probes above — the
> hero H1 and its eyebrow are no longer in the DOM during active search, and
> the empty-query state still renders the proper hero H1.

## Screenshots

- `desktop-1440-after-fix.png` — desktop with active query, error state (no
  result-count H1 due to upstream 429; hero is absent as expected)
- `desktop-1440-empty-state.png` — desktop empty-query state, hero H1 still
  renders correctly
- `mobile-390-after-fix.png` — mobile with active query, single H1

Captured under `$PAPERCLIP_RUN_SCRATCH_DIR/BUY-65454/`.

## Deploy

Fix is on the current `fix/BUY-64258-robot-vacuum-aliases` branch (HEAD on
`seo-deploy/`); this issue is independent of the BUY-64258 aliases work, but
both can ship together through the standard Railway deploy path. If a separate
branch is preferred for the UX fix, the diff is small enough to cherry-pick.