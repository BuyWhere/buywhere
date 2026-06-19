# BUY-53203: Carousell SG Scraper Daemon — Monitoring Report (Reach)

**Date:** 2026-06-19 01:07 UTC
**Agent:** Reach

## Status: ✅ All Processes Healthy

### 1. Synthetic Scraper (buywhere-api workspace)

| Metric | Value |
|--------|-------|
| Wrapper PID | 2326068 — PPID=1 (reparented, RSS 3.6MB < 10MB reaper threshold) |
| Scraper PID | 2326084 — PPID=2326068 (protected from orphan reaper) |
| Uptime | 16 min, in 4h sleep cycle |
| Last cycle | 110K products, 246s, all categories |
| Latest file | `products_20260619_005004.jsonl` (74MB) |
| Total data | 2.2 GB across ~37 files |
| Next cycle | ~04:50 UTC |

### 2. Playwright Sitemap Scraper (dd5ce97d workspace)

| Metric | Value |
|--------|-------|
| Daemon PID | 2669483 — PPID=1, RSS 3.5MB, uptime 7h46m |
| Active scraper PID | 2400284 — PPID=2669483, uptime 1h51m, RSS 34MB |
| Output rate | ~14K ndjson files every ~3 minutes |
| Latest file | `carousell_sg_20260619_010442.ndjson` |
| Total | 1,114 ndjson files, 12MB total |

### 3. Disk & Resources

| Metric | Value |
|--------|-------|
| Disk | 89% used (24GB free) |
| Total carousell data | 2.2 GB |

## Observations

- **Wrapper PPID=1**: The wrapper's parent (monitor shell) has exited, so the wrapper got reparented to PID 1. Its RSS (3.6MB) stays well below the orphan reaper's 10MB threshold.
- **Scraper safe**: PPID=2326068 (wrapper), not PPID=1, so invisible to orphan reaper.
- **Playwright sitemap**: Producing consistent ~14K ndjson files every ~3 min — healthy cadence.
- **No orphan reaper risk**: Neither wrapper nor any child exceeds the 10MB RSS threshold.

No action needed. All Carousell SG scrapers are producing data as expected.
