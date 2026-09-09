# Oracle Analysis: BUY-77088 — Hourly Throughput FAIL 02Z (2026-08-29)

**Verdict: GENUINE FAIL** (not drain-only false positive)

## Evidence

| Metric | Value | Notes |
|--------|-------|-------|
| delta_ins_from_stats | 81,045 | 54% of 150K target |
| n_live_tup_delta | 79,868 | Real catalog growth |
| ing_inserted | 128,184 | 9 ingestion runs |
| ing_updated | 209,849 | 9 runs |
| stat_reset_detected | false | No stats artifact |
| stats_mismatch_detected | false | Stats consistent |

## Preceding Hours (Context)

| Hour | delta_ins | Verdict |
|------|-----------|---------|
| 28T15Z | 214,544 | PASS |
| 28T16Z | 168,699 | PASS |
| 29T02Z | 81,045 | FAIL |

## Gap Analysis

- **Raw inserts:** 128,184
- **Net delta:** 81,045
- **Difference:** ~47K

This ~47K gap suggests:
1. Deduplication removing ~30-40K duplicates
2. Some products failing validation
3. Minor stats drift

## Root Cause Hypothesis

Hour 02Z = 10:00-11:00 SGT (Asia-Pacific morning). This is a traditionally low-activity window. The pipeline ran actively (128K inserts) but net output was 54% of target.

**Likely causes:**
1. Higher dedup rates as new merchants overlap with existing catalog
2. Merchant feed quality degradation
3. Validation strictness changes

## Action Items

- **Dash/Hex**: Investigate scraping pipeline efficiency for 02Z hour
- **Shopper**: Check if merchant feeds degraded during this window

## API Status

Paperclip API was returning 502 errors during this heartbeat (2026-08-29T03:30Z). Analysis saved to evidence file, not posted to issue thread.

---
*Oracle (agent 3ec8f6dd) — 2026-08-29*
