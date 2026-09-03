# BUY-18289 Shopify Ingest Summary

Run date: 2026-05-16 UTC

## Scope

- Executed `scripts/batch_shopify_scraper.py` against the non-`curated` entries in `data/us_shopify_merchants.json`.
- Added targeted filtering and report-path support to the scraper so this ticket can run against a validated subset instead of the full registry.
- Fixed the scraper's success handling to accept the ingest API's real terminal statuses: `completed` and `completed_with_errors`.

## Registry Note

- The current local registry artifact contains 39 non-`curated` Shopify stores, not 41.
- Breakdown from `data/us_shopify_merchants.json`: 23 `top_shopify_lists`, 14 `intl_discovery`, 1 `intl_br`, 1 `sea_discovery`.

## Outcome

- True ingest successes: 14 stores
- Products ingested: 10,894
- Storefront fetch blocked by `403` on `/products.json`: 24 stores
- Storefront fetch succeeded but ingestion failed: 1 store (`baseblu.com`, 2,000 transformed / 0 ingested)

### Successful stores

- `peppermayo.com` — 2,499
- `tigermist.com` — 1,259
- `meshki.com` — 1,920
- `bassike.com` — 762
- `showpo.com` — 2,500
- `frankandoak.com` — 56
- `reigningchamp.com` — 674
- `encircled.ca` — 74
- `saje.com` — 380
- `sugarcosmetics.com` — 281
- `plumgoodness.com` — 372
- `graze.com` — 12
- `heckfood.co.uk` — 26
- `diretodasfabricas.com.br` — 79

### Fetch-blocked stores (`403`)

- `colehaan.com`
- `instantpot.com`
- `colourpop.com`
- `jackery.com`
- `toysrus.com`
- `kyliecosmetics.com`
- `aldoshoes.com`
- `champion.com`
- `molekule.com`
- `lacolors.com`
- `cosori.com`
- `jansport.com`
- `baretraps.com`
- `ravpower.com`
- `wyze.com`
- `aukey.com`
- `modells.com`
- `peterthomasroth.com`
- `physiciansformula.com`
- `morphebrushes.com`
- `jeffreestarcosmetics.com`
- `beautyblender.com`
- `bbox.com`
- `chumbak.com`

### Ingest-blocked store

- `baseblu.com` — fetched 2,000 / transformed 2,000 / ingested 0 / last response recorded as `status=failed` with no HTTP code or error body.

## Artifacts

- Full run report: `reports/BUY-18289-shopify-ingest-report.json`
- Probe report after status fix: `reports/BUY-18289-shopify-ingest-probe.json`
