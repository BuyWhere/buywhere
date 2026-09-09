# BUY-18299: baseblu.com Shopify ingest failure diagnosis

Date: 2026-05-16 UTC

## Root cause

`baseblu.com` is the only merchant in `data/us_shopify_merchants.json` with `country: "SEA"`:

- `data/us_shopify_merchants.json:1188`

The Shopify batch scraper copies that field into `country_code` unchanged:

- `scripts/batch_shopify_scraper.py:157`
- `scripts/batch_shopify_scraper.py:172`
- `scripts/batch_shopify_scraper.py:173`

The ingest API accepts `country_code` from the payload and writes it into `products.country_code`, which is a `VARCHAR(2)` column:

- `api/src/routes/ingest.ts:123`
- `api/src/routes/ingest.ts:268`
- `api/src/routes/ingest.ts:286`
- `api/src/migrate.ts:17`

That makes `country_code="SEA"` fail at the database layer with:

- `Database error: value too long for type character varying(2)`

## Why BUY-18289 showed an empty error

The ingest route returns batch failures in an `errors` array, not a top-level `error` string:

- `api/src/routes/ingest.ts:300`
- `api/src/routes/ingest.ts:320`

The Shopify batch report only records `result.get("error")` into `last_error.error`:

- `scripts/batch_shopify_scraper.py:411`
- `scripts/batch_shopify_scraper.py:416`

So a `207` response with structured `errors` is summarized as:

- `status=failed`
- `http_code=null`
- `error=""`

That matches the BUY-18289 artifact for `baseblu.com`.

## Verification

Reproduced against the live ingest API with a one-product probe:

- `country_code="SEA"` -> `207 failed` with `Database error: value too long for type character varying(2)`
- `country_code="SG"` -> `200 completed`

The probe rows and run records were deleted after verification.

## Recommended fix

One of:

1. Correct `baseblu.com` merchant metadata to use a 2-letter ISO country code, likely `SG`.
2. If the merchant is regional rather than country-specific, stop sending `"SEA"` as `country_code` and keep it only in another field such as `region`.
3. Separately harden `scripts/batch_shopify_scraper.py` to surface `errors[0].error` in reports so future batch failures are diagnosable from artifacts alone.
