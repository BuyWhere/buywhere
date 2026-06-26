# BUY-58096 Evidence — Worker node disk-space enforcement

## Run Summary

- **Issue**: BUY-58096 — Worker node disk-space enforcement (WC cycle artifact cleanup)
- **Run timestamp**: 2026-06-26T23:47:34Z
- **Mode**: standard / apply
- **Disk before**: 69%
- **Disk after**: 69%
- **Alert required**: false (well under 90% threshold)
- **Inner exit**: 0

## Outcome

- **Scanned**: 0 stale cycle NDJSON files in buywhere-api workspace
- **Moved to trash**: 0 files (no stale files found)
- **Skipped (open)**: 0
- **Reclaimed (KB)**: 0
- **Alert threshold**: 90% — not triggered

## Artifacts Created

- `scripts/run-buy-58096-worker-wc-cycle-cleanup.sh` — apply-mode runner targeting buywhere-api workspace with `--keep=48 --alert-pct=90`
- `scripts/run-buy-58096-worker-disk-enforcement.sh` — disk check wrapper that triggers cleanup when disk > 80%
- `scripts/setup-buy-58096-worker-node-disk-space-enforcement.sh` — idempotent cron installer

## Cron Installed

- `*/10 * * * *` — disk enforcement (every 10 minutes)
- `*/30 * * * *` — WC cycle cleanup (every 30 minutes)
- Markers: `disk-enforcement-buy-58096-cron`, `wc-cleanup-buy-58096-cron`
- Verified: exactly 1 of each entry in crontab

## Logs / Reports

- `logs/buy-58096-wc-cycle-enforcement-report.json` — full report
- `logs/buy-58096-disk-enforcement.log` — cron log

## BUY-30774 Compliance

This run prevents the root filesystem hitting 100% (the recurring BUY-30774 infra cap) by:
1. Applying retention (`--keep=48`) on WC cycle NDJSON artifacts
2. Moving stale files to reversible trash with 48h retention
3. Alerting when disk > 90%
4. Auto-triggering via cron every 10–30 minutes
