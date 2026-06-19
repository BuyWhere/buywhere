# BUY-53482 worker node disk-space enforcement (WC cycle artifact cleanup)

Verified on 2026-06-19.

## Summary

- Confirmed the checked-out workspace already enforces a post-cleanup disk threshold in `scripts/buy-53114-worker-node-artifact-cleanup.sh`.
- Confirmed the worker cleanup report includes `alert_threshold_pct` and `alert_required`.
- Confirmed the cleanup script returns exit code `10` when post-cleanup disk usage still exceeds `ALERT_PCT`.
- Confirmed `scripts/run-buy-52997-disk-watchdog-cron.sh` treats worker cleanup exit code `10` as a non-fatal threshold breach and still runs the downstream watchdog stage.

## Verification

1. Syntax checks passed:
   - `bash -n scripts/buy-53114-worker-node-artifact-cleanup.sh`
   - `bash -n scripts/run-buy-52997-disk-watchdog-cron.sh`
2. Focused fixture run against a temporary isolated worker root containing stale `logs/`, `runs/`, disk-monitor data, and report artifacts:
   - `ALERT_PCT=100` exited `0`
   - cleanup report recorded `removed_count=6`
   - cleanup report recorded `alert_required=0`
3. Threshold-breach verification against the same fixture after cleanup:
   - `ALERT_PCT=0` exited `10`
   - cleanup report recorded `alert_required=1`
4. Cron-wrapper verification against the same temporary root:
   - `WORKER_CLEANUP_ALERT_PCT=0` caused the worker cleanup stage to return `10`
   - `scripts/run-buy-52997-disk-watchdog-cron.sh` still continued into `scripts/run-buy-48198-disk-watchdog.sh`
   - wrapper exit code was `0`

## Outcome

No code changes were required in this heartbeat because the enforcement behavior requested by BUY-53482 is already present in the workspace. This heartbeat verified the behavior and left an issue-specific report artifact.
