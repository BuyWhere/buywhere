# BUY-53434 worker node disk-space enforcement (WC cycle artifact cleanup)

Verified on 2026-06-19.

## Summary

- Added disk-threshold enforcement to `scripts/buy-53114-worker-node-artifact-cleanup.sh`.
- The worker cleanup report now includes `alert_threshold_pct` and `alert_required`.
- The worker cleanup script now returns exit code `10` when post-cleanup disk usage still exceeds `ALERT_PCT`.
- Updated `scripts/run-buy-52997-disk-watchdog-cron.sh` to pass `WORKER_CLEANUP_ALERT_PCT` through and treat exit code `10` as a non-fatal threshold breach so the downstream watchdog still runs.

## Verification

1. Syntax checks passed:
   - `bash -n scripts/buy-53114-worker-node-artifact-cleanup.sh`
   - `bash -n scripts/run-buy-52997-disk-watchdog-cron.sh`
2. Focused dry-run against a temporary worker-root fixture with stale `logs/worker-old.log` and `runs/old` entries:
   - `ALERT_PCT=0` returned exit code `10` and wrote `"alert_required": 1` to the worker cleanup report.
   - `ALERT_PCT=100` returned exit code `0` and wrote `"alert_required": 0` to the worker cleanup report.
3. Full cron-wrapper dry-run against the same temporary root:
   - Worker cleanup completed with `rc=10`.
   - The wrapper continued into `scripts/run-buy-48198-disk-watchdog.sh`.
   - The wrapper exited `0`, confirming the threshold breach is logged without aborting the downstream watchdog stage.

## Changed Files

- `scripts/buy-53114-worker-node-artifact-cleanup.sh`
- `scripts/run-buy-52997-disk-watchdog-cron.sh`
