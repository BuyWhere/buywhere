# BUY-74774 — DONE 2026-08-25T10:41Z

## Problem
Reach T462 (2026-08-25T09:50Z) and Trend T463 (~10:50Z) confirmed durable
api-host AEO surface regression: api.buywhere.ai served shrunk bodies vs
apex (buywhere.ai) on four surfaces:

| Surface | api-host pre | apex | status |
|---|---|---|---|
| `/.well-known/mcp.json` | 493B | 8063B | shrunk (0 tools listed vs 13 v2-first) |
| `/llms.txt` | 820B | 4165B | shrunk (SG-only stub vs canonical) |
| `/developers/sitemap-index.xml` | 242B / 1 loc | 1269B / 9 locs | shrunk (single sitemap vs full index) |
| `/sitemap-compare.xml` | 110B / 0 locs | 192916B / 958 locs | broken (empty urlset) |

`/sitemap-products.xml` PARITY (100 locs) explicitly OUT OF SCOPE per parent issue.

## Root cause
api.buywhere.ai (Express / Railway hikari) registered inline stubs that
frozen the canonical surfaces to early-version snapshots:

- `wellknown.ts` `/.well-known/mcp.json` returned the v0.1 stub (8-line
  minimal manifest, 6 capabilities).
- `server.ts` inline `app.get('/llms.txt', ...)` shipped the SG-only
  BuyWhere blurb (820B) instead of the apex `public/llms.txt` body (4165B).
- `server.ts` inline `app.get('/developers/sitemap-index.xml', ...)`
  emitted a single-sitemap index pointing only at `/developers/sitemap.xml`,
  not the canonical 9-sitemap listing.
- `sitemapCompare.ts` was DB-backed against the api host's
  `comparison_pages` table (4 rows in `sakura.proxy.rlwy.net:22987`,
  pre-data-state table) which has nothing to do with the apex
  PRODUCT_TAXONOMY-driven enumerator. The query wrapped in
  `.catch(() => null)` silently swallowed errors and returned empty results.

## Fix
All four surfaces now flow through a new `apexDiscoveryProxyRouter` mounted
in `server.ts` BEFORE the inline stubs so Express registration order
short-circuits them:

- New file: `api/src/routes/apexDiscoveryProxy.ts` (107 lines, mirrors the
  established `sitemapProxy.ts` pattern from BUY-74662).
- `server.ts`: import + mount `apexDiscoveryProxyRouter` before the
  `sitemapCompareRouter`; remove inline `/llms.txt` and
  `/developers/sitemap-index.xml` stubs (they are unreachable after the
  proxy, so deletion is safer than dead code).
- `wellknown.ts`: remove inline `/.well-known/mcp.json` handler so Express
  falls through to the proxy.
- `api/tests/developers-public-routes.test.mjs`: update assertion to
  require ≥9 `<sitemap>` entries (was 1) reflecting the apex-parity
  contract.

The four routes are: `/llms.txt`, `/.well-known/mcp.json`,
`/developers/sitemap-index.xml`, `/sitemap-compare.xml`.

Apex remains the canonical source of truth. No drift between hosts.

## Commits
- `e18454ee` (push #1) — fix(BUY-74774): proxy 4 AEO surfaces on api host
  to apex (mcp.json / llms.txt / developers/sitemap-index / sitemap-compare)
- `f9dfb792` — docs(BUY-74774): add deployment note to apexDiscoveryProxy header
- `3f217455` — merge origin/main into BUY-74774 (PR #703 lands before our fix)

## Deploy
- Railway build id: `867aee74-781b-41b8-87fe-9b6e4c9e061f` (SUCCESS, 2026-08-25T10:41Z)
- deploy-api workflow run: <https://github.com/BuyWhere/buywhere/actions/runs/32838145879> (completed success)
- Origin/main at evidence time: `3f217455`
- Note: the first attempt at this deploy failed the deploy-api smoke
  test (search endpoint warm-up flakiness — search returned no `<id>` for
  5 × 45s retries against the freshly-warmed api host container). The
  auto-rollback stepped back to `08011485`; second push (after the
  upstream-merge + docs commit) cleared warm-up in ~5 minutes and
  succeeded.

## Live verification (post-deploy)
```
=== /sitemap-compare.xml diff (first 200 chars) ===
<     <lastmod>2026-08-25T10:41:42.090Z</lastmod>          (apex)
>     <lastmod>2026-08-25T10:41:42.078Z</lastmod>          (api)
                                                ↑ only diff is 12ms lastmod

=== /sitemap-compare.xml url counts ===
apex urls: 958
api urls:  958

=== /developers/sitemap-index.xml sitemap counts ===
apex sitemaps: 9
api sitemaps:  9

=== /llms.txt ===
(no diff = byte-identical, 4165B both)

=== /.well-known/mcp.json sha256 (16 chars) ===
apex: 610f137f2385cdda
api:  610f137f2385cdda             ← byte-identical to apex
=== tools count ===
apex: 13
api:  13
```

## Test suite
- 153/153 buywhere-api tests pass (`npm test`).
- `developers-public-routes.test.mjs` updated and passes locally.
- `tsc --noEmit` clean (0 errors vs 0 baseline).
- AEO bodies served via `x-apex-discovery-proxy: apex->api:<path>` debug header.

## Notes for follow-ups
1. `/sitemap-products.xml` parity drift (22391B → 25488B) is OUT OF SCOPE —
   Trend will re-probe on T+1 schedule; not a BUY-74774 contract.
2. `/developers/sitemap.xml` (NOT index) still emits 2 hardcoded urlset
   entries; if Trend flags it later the same proxy pattern applies.
