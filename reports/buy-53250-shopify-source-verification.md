# BUY-53250: Shopify Source Remediation Verification Report

**Date:** 2026-06-19  
**Verifier:** Dash (codex_local)  
**Status:** PASS — No bare `source='shopify'` found in codebase or data

## Scope

Remediate all Shopify discovery/writer entrypoints that emit bare `source='shopify'` instead of domain-scoped keys like `shopify_{normalized_domain}`.

## Changes Applied

### 1. Python API Guard (`app/routers/ingest.py`)

Added a rejection guard in `normalize_source()` that raises `ValueError` when source resolves to bare `"shopify"`. The `ingest_products` handler now catches both `ValidationError` and `ValueError`, returning a structured 400 response.

### 2. TypeScript API Guard (`api/src/routes/ingest.ts`)

Already existed (line 284). Returns HTTP 400 with `code: 'deprecated_source'` when source is bare `"shopify"`.

### 3. Python Scraper Normalization (`scripts/batch_shopify_scraper.py`)

`normalize_shopify_source()` already handles bare `"shopify"`, `None`, empty string, and all `SHOPIFY_SOURCE_OVERRIDES` — converting them to `shopify_{domain_slug}`.

## Audit Results

### All files referencing `"shopify"` inspected (12 total):

| File | Usage | Safe? |
|------|-------|-------|
| `api/src/routes/ingest.ts` | Guard rejecting bare `"shopify"` | ✅ |
| `app/routers/ingest.py` | Guard rejecting bare `"shopify"` | ✅ |
| `scripts/batch_shopify_scraper.py` | `normalize_shopify_source()` comparison + override list | ✅ |
| `scrapers/shopify_scraper.py` | CLI example shows `--source shopify_storymfg` | ✅ |
| `scrapers/shopify_feed_discovery.py` | Default: `shopify_feed_discovery`, output: `shopify_{slug}` | ✅ |
| `scrapers/discover_compact.py` | Output: `shopify_{slug}` | ✅ |
| `scrapers/discover_merge.py` | `platform: "shopify"` only — not source assignment | ✅ |
| `scrapers/discover_us_v2.py` | `platform: "shopify"` only — not source assignment | ✅ |
| `scrapers/social_commerce_main.py` | `platform: "shopify"` only — not source assignment | ✅ |
| `scripts/domain_source_gatherer.py` | `platform_hint: "shopify"` only — discovery metadata | ✅ |
| `scripts/validate_shopify_candidates.py` | String contains check `"shopify" in server` | ✅ |
| `scripts/competitor_intelligence.py` | Keyword in search list | ✅ |

### Data files scanned: 35+ JSON/JSONL files — **0 bare `source="shopify"` found**

### Note on issue-referenced .mjs scripts

The 13 scripts referenced in the issue summary (`cc-shopify-discover-v2.mjs`, `shopify-mass-discover-v2.mjs`, etc.) **do not exist in this workspace** — not in the working tree, not in any git branch, not in git history. They may have lived in a different repository or been removed during prior cleanup. All active Shopify ingestion paths in this repo are already domain-scoped.

## Conclusion

✅ **All remediation complete.** Both API layers reject bare `source='shopify'` with clear error messages, and no writer or data file in this workspace emits it. The `batch_shopify_scraper.py` normalization catches any residual cases at scrape time.
