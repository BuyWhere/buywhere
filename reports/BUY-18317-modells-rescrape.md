# BUY-18317 modells.com page-2 repro and recovery notes

Date: 2026-05-16 UTC

## Reproduction

- `https://modells.com/products.json?limit=250&page=1` returned `HTTP 200`.
- `https://modells.com/products.json?limit=250&page=2` returned `HTTP 500` with an empty body.
- `https://modells.com/products.json?limit=250&page=3` also returned `HTTP 500`.

## Catalog fallback discovery

- `https://modells.com/sitemap.xml` returned `HTTP 200`.
- The sitemap exposed 3 product sitemap files.
- Combined product URL count discovered from those sitemap files: `5825`.
- Individual product JSON endpoints at `https://modells.com/products/{handle}.json` returned `HTTP 200` in low-rate probes.

## Workspace change

- Updated `scripts/batch_shopify_scraper.py` with a Shopify sitemap fallback for merchants whose paginated `products.json` endpoint fails after page 1.
- The fallback extracts product handles from Shopify product sitemaps and fetches per-product JSON, with low-concurrency retries to avoid storefront blocking.

## Live run constraint

- A high-concurrency validation pass recovered only `321` products before the storefront began returning `403` for most per-product JSON requests.
- This indicates the source can be recovered via sitemap, but the full re-scrape from the current IP still needs a slower rerun or a fresh egress IP after cooldown.
