# BUY-53512 Worker node disk-space enforcement (WC cycle artifact cleanup)

- Verified the checked-out workspace already includes the worker-node cleanup enforcement path in `scripts/run-buy-52997-disk-watchdog-cron.sh`, which runs:
  - `scripts/wc-cycle-cleanup.sh --apply --keep=48`
  - `scripts/buy-53114-worker-node-artifact-cleanup.sh`
  - `scripts/run-buy-48198-disk-watchdog.sh`
- Executed the canonical BUY-48198 cron wrapper with BUY-53512-scoped artifacts:
  - `LOG_FILE=logs/buy53512_disk_watchdog_cron.log DISK_STATE_FILE=/tmp/buy-53512-disk-state.json DISK_SNAPSHOT_DIR=data/buy-53512-disk-monitor-2026-06-19T101934Z DISK_EXECUTION_ISSUE=BUY-53512 bash scripts/run-buy-48198-disk-watchdog-cron.sh`

## Result

- WC cleanup completed successfully.
- Worker artifact cleanup completed successfully with `rc=0`.
- The worker cleanup removed 3 stale artifacts during this run:
  - `data/.buy31015-deep-page.pid`
  - two stale `__pycache__` directories in another workspace restore tree
- Cleanup report: `/paperclip/instances/default/workspaces/logs/buy53114_worker_wc_cycle_cleanup_report.json`
  - `removed_count=3`
  - `failed_count=0`
  - `disk_after_pct=84`
  - `disk_free_kb=33159464`
- The disk watchdog finished `PASS` after cleanup with:
  - `31.6 GB` free
  - warn threshold `20.0 GB`
  - critical threshold `5.0 GB`
  - snapshot at `data/buy-53512-disk-monitor-2026-06-19T101934Z`

## Verification

- `bash -n scripts/buy-53114-worker-node-artifact-cleanup.sh`
- `bash -n scripts/run-buy-52997-disk-watchdog-cron.sh`
- `bash -n scripts/run-buy-48198-disk-watchdog-cron.sh`
- `node --test api/tests/disk-watchdog.test.mjs`

## Files

- `scripts/buy-53114-worker-node-artifact-cleanup.sh`
- `scripts/run-buy-52997-disk-watchdog-cron.sh`
- `scripts/run-buy-48198-disk-watchdog-cron.sh`
- `reports/BUY-53512-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.md`
