# BUY-72364 — Done

## Live verification (post-deploy, 05:56:38Z)

```
$ curl -s "https://buywhere.ai/search?q=laptop&country=us" | grep -oE '<h1[^>]*>[^<]*</h1>'
<h1 class="mt-1 text-2xl font-semibold text-slate-950">Search results for "laptop"</h1>
```

- Real Unicode curly quotes (U+201C / U+201D), zero `&amp;ldquo;` / `&amp;rdquo;` entities ✅
- HTTP 200, page renders
- Same probe across multiple markets confirmed clean

## Source change

`src/app/search/SearchResultsClient.tsx` — 5 sites converted from `&ldquo;`/`&rdquo;` HTML entities to actual Unicode characters:

| Line | Site |
|------|------|
| 1091 | mobile compact summary result count |
| 1321 | desktop H1 (loaded state) |
| 1322 | desktop H1 (SSR initialQuery state) |
| 1344 | degraded-state banner |
| 1376 | no-results message |

Commit `c6b8f89b2` on `main`.

## Deploy verification

| Workflow | Run | Status |
|----------|-----|--------|
| deploy-www | #424 | completed success |
| Build site image | #1200 | completed success |

Both green per BUY-64734 mid-deploy-race pattern.

## Root cause correction

Issue description claimed "source already correct, stale deploy". That's wrong — source had been **regressed** by Hex's reset-and-reapply (`554950c75`, BUY-71746) on 2026-08-19, the same footgun in MEMORY.md that stripped P2.6 wire on 2026-08-21.

The fix (Unicode curly quotes) had previously shipped as `c58e15183` (Vera, BUY-70335, 2026-08-16) but was reverted as collateral damage by `554950c75`. This PR re-applies it.

## Parent

BUY-72348 (QA-reported H1 bug) — root cause diagnosed (regressed source, not stale deploy), unblocked by this fix.
