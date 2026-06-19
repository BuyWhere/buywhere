# BUY-53419 safe-data-cleanup sweep

## What changed

- Ran the existing narrow cleanup script in dry-run mode first with an issue-local log: `REPORT_PATH=reports/BUY-53419-safe-data-cleanup-report.txt ./scripts/buy-53125-safe-data-cleanup.sh`
- Applied the same cleanup after confirming it would only remove one stale `data/buy-48198-disk-monitor-*` directory: `REPORT_PATH=reports/BUY-53419-safe-data-cleanup-report.txt ./scripts/buy-53125-safe-data-cleanup.sh --apply`
- Left the sole `data/carousell-sg/products_*.jsonl` snapshot untouched because it is still within the script's retention policy.

## Verification

- Dry-run predicted exactly one deletion:
  - `data/buy-48198-disk-monitor-2026-06-19T065036Z`
- Apply run deleted that directory and logged `removed=1 reclaimed_kb=20`.
- Post-cleanup check shows only the newest two monitor directories remain:
  - `data/buy-48198-disk-monitor-2026-06-19T065518Z`
  - `data/buy-48198-disk-monitor-2026-06-19T070019Z`

## Artifacts

- Detailed deletion log: `reports/BUY-53419-safe-data-cleanup-report.txt`
