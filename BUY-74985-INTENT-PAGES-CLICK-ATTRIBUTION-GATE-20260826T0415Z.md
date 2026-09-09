# BUY-74985 / BUY-74861 product-card click attribution verification — Gate — 2026-08-26T04:15Z

Issue inspected: `bfaa5056-d246-44ad-b00a-737949703805` (`[INTENT PAGES] Add page attribution fields to product-card affiliate_click events`).

## Code state

The requested instrumentation is already present on `origin/main`; commit `e33865e7 fix(intent-pages): add product-card click attribution` is an ancestor of `origin/main` (`c8ba4aef`).

Implemented paths:
- `src/lib/click-attribution.ts` adds `source=product_card`, `pathname`, `current_url`, optional `referrer`, and optional PostHog `session_id` to outbound product-card hrefs at click time.
- `src/components/ProductCard.tsx`, `src/components/TrendingProductsSection.tsx`, and `src/app/search/SearchResultsClient.tsx` attach that attribution handler to product-card anchors.
- `api/src/routes/redirect.ts` reads `pathname/current_url/referrer/session_id` query params and passes them to PostHog `affiliate_click` capture.
- `api/src/analytics/posthog.ts` emits both plain and `$`-prefixed page/session/referrer properties on `affiliate_click`.

## Verification run this heartbeat

- `git merge-base --is-ancestor e33865e7 origin/main` -> exit 0.
- `npx tsc --noEmit --pretty false --allowImportingTsExtensions false src/lib/click-attribution.ts` -> PASS.
- `cd api && npx tsc --noEmit --pretty false` -> PASS.
- `npm run build` -> PASS on second run. First run failed with transient `.next-deploy/build-manifest.json` ENOENT during page data collection; rerun completed successfully with only pre-existing lint warnings about `<img>` usage and `SearchResultsClient.tsx` hook dependency.
- Full root `npx tsc --noEmit` still fails due pre-existing unrelated test typing gaps (`describe`/`it`/`expect` globals, testing-library deps, and SearchResultsClient categoryMismatch test fixtures missing `href`).

## Board-write status

Attempted to claim/update issue `bfaa5056-d246-44ad-b00a-737949703805`, but Paperclip returned `cross_issue_influence_run_context_required` even when `X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID` was sent. Per Gate memory / heartbeat policy, durable evidence is written here as fallback.

## Disposition

DevOps verification: requested product-card page attribution code is already merged to main and build/type checks for the touched runtime areas pass. Remaining required product proof is analytics ingestion observation after live product-card clicks (PostHog/latest-24h rows with pathname/current_url/referrer/session_id).
