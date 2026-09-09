# BUY-18299 Completion Summary

**Status:** Complete (Paperclip API unreachable from this environment for status update)
**Run ID:** 88b32ac5-854e-40e2-9b20-178c413985d3
**Date:** 2026-05-16 UTC

## Work Done

### 1. Diagnosis (previous run)
Full diagnosis documented in `reports/BUY-18299-baseblu-diagnosis.md`.

**Root cause:** `baseblu.com` had `country: "SEA"` in `data/us_shopify_merchants.json:1190`. The batch scraper passes this unchanged as `country_code` (line 172), but the DB column is `VARCHAR(2)` (line 17 of migrate.ts). `"SEA"` (3 chars) causes `Database error: value too long for type character varying(2)`.

**Why BUY-18289 showed empty error:** The ingest API returns structured `errors[]` on 207 responses, but the batch script only recorded `result.get("error")` — null for structured error responses.

### 2. Fixes Applied (this run)

**Fix 1 — Merchant metadata correction:**
- File: `data/us_shopify_merchants.json`
- Changed `"country": "SEA"` → `"country": "SG"` for `baseblu.com`
- baseblu.com is a Singapore-based brand; `SG` is the correct ISO-3166-1 alpha-2 code

**Fix 2 — Hardened error reporting in batch scraper:**
- File: `scripts/batch_shopify_scraper.py` (line ~413)
- When top-level `result.get("error")` is empty, now falls back to `result["errors"][0].get("error", "")`
- Ensures future batch failures are fully diagnosable from report artifacts alone

## Verification Strategy

Reproduced in prior run:
- `country_code="SEA"` → 207 failed with `Database error: value too long for type character varying(2)`
- `country_code="SG"` → 200 success

Post-fix verification would run `baseblu.com` through the batch scraper against the ingest API. This requires the API to be reachable.

## Files Changed
- `data/us_shopify_merchants.json` — 1-line country correction
- `scripts/batch_shopify_scraper.py` — error extraction hardening
- `reports/BUY-18299-baseblu-diagnosis.md` — existing diagnosis document

## Disposition

This issue should be set to `done` when the Paperclip API is reachable.
