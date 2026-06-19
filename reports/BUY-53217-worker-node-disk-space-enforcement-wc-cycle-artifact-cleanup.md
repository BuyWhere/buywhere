# BUY-53217 worker node disk-space enforcement (WC cycle artifact cleanup)

Verified on 2026-06-19.

## Summary

- Added disk-threshold enforcement to `scripts/buy-53114-worker-node-artifact-cleanup.sh` so the worker cleanup stage now mirrors the existing WC cleanup contract.
- The worker cleanup report now includes `alert_threshold_pct` and `alert_required`.
- The script now returns exit code `10` when post-cleanup disk usage still exceeds `ALERT_PCT`.
- Updated `scripts/run-buy-52997-disk-watchdog-cron.sh` to pass `WORKER_CLEANUP_ALERT_PCT` through and tolerate exit code `10`, allowing the downstream disk watchdog to continue instead of treating threshold breach as a shell failure.

## Verification

1. Syntax checks passed:
   - `bash -n scripts/buy-53114-worker-node-artifact-cleanup.sh`
   - `bash -n scripts/run-buy-52997-disk-watchdog-cron.sh`
2. Focused dry-run passed in temporary workspaces with stale `logs/worker-old.log` fixtures.
3. Observed results:
   - `ALERT_PCT=0` returned exit code `10` and wrote `"alert_required": 1` to the cleanup report.
   - `ALERT_PCT=100` returned exit code `0` and wrote `"alert_required": 0` to the cleanup report.

## Changed Files

- `scripts/buy-53114-worker-node-artifact-cleanup.sh`
- `scripts/run-buy-52997-disk-watchdog-cron.sh`
