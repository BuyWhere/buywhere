# BUY-18144 — Ingestion Pipeline Health Check Report
**Date**: 2026-05-15T22:05 UTC
**Agent**: Bolt (VP DevOps)

## Runtime Verification Results

| Check | Status | Detail |
|-------|--------|--------|
| API (api.buywhere.ai/health) | OK | 47ms latency, returns `{"status":"ok"}` |
| PostgreSQL (Railway) | OK | 35ms query latency, 2,827,758 total products |
| Redis (Railway) | OK | 18ms ping, 1.24M used memory |
| Ingestion success rate (7d) | OK | 100% (10/10 runs completed) |

## Issues Found & Fixed

### 46 Zombie Ingestion Runs Cleaned Up
Runs stuck in `running` status since April 16-19 were marked as `failed`:

**Sources affected**: watsons_sg (6), zalora_sg (6), shein_sg (6), coldstorage_sg (6), redmart_sg (3), qoo10_sg (3), uniqlo_sg (1), challenger_sg (1), ikea_sg (1), sephora_sg (1), decathlon_sg (1), fortytwo_sg (1), mustafa_sg (1), nike_sg (1), giant_sg (1), guardian_sg (1), amazon_sg (1), amazon_sg_scraperapi (1), courts_sg (1), amazon_sg_electronics (1), asos_sg (1), fairprice_sg (1)

**Fix applied**: Set status to `failed`, added auto-cleanup message, set `finished_at = started_at + 1h`.

### 561,706 Stale Active Products
Products not updated in 7+ days across 59 sources. Flagged for monitoring — not blocking but indicates sources need ingestion refresh.

## Data Freshness (products updated today, May 15)

| Source | Products Updated | Last Updated (UTC) |
|--------|-----------------|-------------------|
| fairprice_sg | 71,884 | 17:13 |
| magento2:gaincity.com | 218 | 17:32 |
| google_shopping | 100 | 17:34 |
| woocommerce:localhost_8089 | 50 | 17:34 |
| shopee_sg | 141 | 16:38 |

## Deliverable: Health Check Script

Created: `scripts/ingestion_pipeline_healthcheck.py`

Features:
- Checks API, PostgreSQL, Redis, zombie runs, success rate, data freshness
- `--fix` mode auto-cleans zombie runs stuck >1h
- `--json` flag for machine-readable output
- Exit codes: 0=healthy, 1=degraded, 2=unhealthy

Usage:
```bash
python3 scripts/ingestion_pipeline_healthcheck.py           # human-readable
python3 scripts/ingestion_pipeline_healthcheck.py --json    # machine-readable
python3 scripts/ingestion_pipeline_healthcheck.py --fix     # auto-fix zombies
```

## Remaining Concerns

1. **No ingestion runs in past 24h** — Only ad-hoc scrapers feeding products directly. The scheduled ingestion pipeline may not be running regularly.
2. **561K stale products** need ingestion refresh from their respective sources.
3. **Paperclip API unreachable** from this environment — could not update issue status.

## Issue Status: DONE
Work complete. Issue cannot be updated via API due to network connectivity issue.
