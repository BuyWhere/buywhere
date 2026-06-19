# BUY-53517 Worker node disk-space enforcement (WC cycle artifact cleanup)

Verified on 2026-06-19.

## Scope

- Re-ran the canonical BUY-48198 disk-watchdog cron wrapper so this heartbeat exercised the full cleanup chain in production order:
  - `scripts/wc-cycle-cleanup.sh --apply --keep=48`
  - `scripts/buy-53114-worker-node-artifact-cleanup.sh`
  - `scripts/run-buy-48198-disk-watchdog.sh`

## Command

```bash
LOG_FILE="$PWD/logs/buy53517_disk_watchdog_cron.log" \
DISK_STATE_FILE="/tmp/buy-53517-disk-state.json" \
DISK_SNAPSHOT_DIR="$PWD/data/buy-53517-disk-monitor-2026-06-19T103333Z" \
DISK_EXECUTION_ISSUE=BUY-53517 \
bash scripts/run-buy-48198-disk-watchdog-cron.sh
```

## Result

- Exit code: `0`
- WC cleanup completed successfully with `rc=0`
  - `workspace_count=2`
  - `moved_count=0`
  - `purged_count=0`
  - `alert_required=0`
- Worker artifact cleanup completed successfully with `rc=0`
  - `scanned_count=14`
  - `removed_count=1`
  - `skipped_undeletable_count=5`
  - `failed_count=0`
  - `reclaimed_kb=1`
  - Removed stale artifact: `data/.buy31015-deep-page.pid`
- Root filesystem after worker cleanup: `85%` used, `31900676 KB` free
- Disk watchdog snapshot passed:
  - `status=PASS`
  - `free_bytes=32666292224` (`30.4 GB`)
  - warn threshold `20.0 GB`
  - critical threshold `5.0 GB`
  - snapshot dir `data/buy-53517-disk-monitor-2026-06-19T103333Z`

## Verification

- `bash -n scripts/buy-53114-worker-node-artifact-cleanup.sh`
- `bash -n scripts/run-buy-52997-disk-watchdog-cron.sh`
- `bash -n scripts/run-buy-48198-disk-watchdog-cron.sh`
- `node --test api/tests/disk-watchdog.test.mjs`

## Artifacts

- Markdown report: `reports/BUY-53517-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.md`
- Cron log: `logs/buy53517_disk_watchdog_cron.log`
- WC cleanup report: `/paperclip/instances/default/workspaces/logs/buy53095_wc_cycle_cleanup_report.json`
- Worker cleanup report: `/paperclip/instances/default/workspaces/logs/buy53114_worker_wc_cycle_cleanup_report.json`
- Disk snapshot: `data/buy-53517-disk-monitor-2026-06-19T103333Z/result.json`
