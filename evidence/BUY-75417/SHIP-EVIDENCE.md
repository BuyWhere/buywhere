# BUY-75417 — server-render `/r/` affiliate-redirect anchors

## What changed

- `src/lib/affiliate-redirect.ts` — new helper module, two pure functions:
  - `buildAffiliateRedirectHref(rawHref)` — converts `https://buywhere.ai/r/direct/{id}?…`
    or `https://api.buywhere.ai/r/direct/{id}?…` to the site-relative `/r/direct/{id}?…`
    form; rejects raw merchant URLs (returns `null`).
  - `buildAffiliateRedirectFromProductId(productId, source)` — convenience
    builder for `/r/direct/{productId}?source={source}`.
- `src/components/seo/ProductGridCard.tsx` — converted the merchant CTA
  from `<span role="button">` (JS-only, fired by `window.open`) to a
  server-rendered `<a href="/r/…" target="_blank" rel="nofollow sponsored noopener noreferrer">`.
  The existing `handleMerchantClick` is preserved as progressive
  enhancement (still calls `window.open` for JS users; the `<a>` is the
  no-JS fallback and the crawler-visible path).
- `src/app/products/sg/[slug]/page.tsx` — wrapped the retailer name cells
  in the SSR price table `<tbody>` with `<a href="/r/direct/{id}?source=sg_table">`
  and added a "View at <merchant>" CTA in the visible card grid below
  (`?source=sg_card`).
- `src/components/seo/USProductSsrPriceTable.tsx` — wrapped the retailer
  name cells with `<a>` that prefers `row.url` when it is already a
  buywhere.ai `/r/…` URL, and falls back to `/r/direct/{id}?source=us_table`
  for raw merchant URLs.

`/r/*` is already rewritten to `https://api.buywhere.ai/r/*` by
`next.config.mjs` lines 400-407, and the redirect handler at
`api/src/routes/redirect.ts` logs to `affiliate_clicks`. No API or
config changes.

## Out of scope (deliberately)

- `/deals` — `/api/v1/deals` is 404 on prod today; the page always renders
  the empty state. Fixing the deals API is unrelated.
- `/brands/[slug]` — its primary CTA is `product.compare_url` (an internal
  link to `/compare`/`/products/...`), not a merchant redirect. Not a `/r/`
  issue.

## Local evidence (rendered before deploy)

Captured with `render-evidence.tsx` (React SSR + tsx) — both surfaces
now ship `<a href="/r/direct/{id}?source=…" target="_blank" rel="nofollow sponsored noopener noreferrer">`
in the SSR HTML.

```
PASS ProductGridCard: contains /r/ anchor: href="/r/direct/54614597?source=product_card"
PASS ProductGridCard: contains rel=nofollow sponsored: rel="nofollow sponsored noopener noreferrer"
PASS ProductGridCard: contains Buy at <merchant> label: Buy at Shopee Singapore
PASS ProductGridCard: contains data-affiliate-redirect marker: data-affiliate-redirect="intent-product-card"
PASS ProductGridCard: NO <span role=button>: role="button"
PASS US table: contains /r/ anchor (already-buywhere URL row): href="/r/direct/54437835?source=us_table"
PASS US table: contains fallback /r/direct/{id} anchor for raw merchant row: href="/r/direct/54437835?source=us_table"
PASS US table: contains rel=nofollow sponsored: rel="nofollow sponsored noopener noreferrer"
```

Full output saved to `evidence/BUY-75417/EVIDENCE-OUTPUT.txt`.

## Post-deploy evidence (Reach, after merge)

After Reach merges and the deploy-www workflow runs, the prod curls
the issue asks for:

```
curl -sL -A "OAI-SearchBot/1.0" "https://buywhere.ai/laptop-singapore" \
  | grep -oE 'href="/r/[^"]*"' | head -5

curl -sL -A "OAI-SearchBot/1.0" "https://buywhere.ai/products/sg/macbook-air-13-m3" \
  | grep -oE 'href="/r/[^"]*"' | head -5

curl -sL -A "OAI-SearchBot/1.0" "https://buywhere.ai/products/us/asus-rog-zephyrus-g16" \
  | grep -oE 'href="/r/[^"]*"' | head -5
```

should each return ≥ 1 `/r/direct/{id}` anchor with `rel="nofollow sponsored"`.

## Branch

- Branch: `seo-gate/buy-75417-server-render-r-anchors`
- Commit: `d1b77aa40`
- PR: https://github.com/BuyWhere/buywhere/pull/730 (draft)
- Diff stat: 5 files changed, 207 insertions(+), 9 deletions(-)

## Build & test status

- `npx tsc --noEmit` on changed files: clean.
- `npm run build`: passes (pre-existing test infra failures in
  src/components/ui/*.test.tsx and src/lib/product-schema.test.ts are
  unrelated to this change).
- `npx tsx --test src/lib/affiliate-redirect.test.ts`: 6/6 pass.
- `npx tsx evidence/BUY-75417/render-evidence.tsx`: 8/8 pass.

## NOT done here

- Did NOT push to main — SEO-GATE policy: deploys are batched by Reach
  and frozen while search smoke is red; this PR is ready for Reach to
  merge.
- Did NOT modify the public/robots.txt, src/lib/sitemaps.ts, or footer —
  that's ops' SEO-GATE BUY-75497 items 1-3 (already shipped as
  a8c4fd328).
