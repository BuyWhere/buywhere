# BUY-53476 worker node disk-space enforcement (WC cycle artifact cleanup)

Verified on 2026-06-19.

## Scope

- Extended `scripts/buy-53114-worker-node-artifact-cleanup.sh` so the worker cleanup pass also prunes stale disk-monitor artifacts created by the watchdog workflow.
- Covered three generated artifact classes with a shared retention control:
  - `data/buy-*-disk-monitor-*` snapshot directories
  - `data/buy-*-disk-state.json` state snapshots
  - `reports/BUY-*-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.*` and `reports/BUY-*-disk-space-watchdog-5min-*.md`

## Retention

- New environment variable: `DISK_ARTIFACT_RETENTION_DAYS`
- Default: `2`

## Verification

Executed the cleanup script against an isolated temporary workspace fixture in `APPLY=1` mode with artifacts aged to five days old.

Result:

- Exit code: `0`
- Entries scanned: `4`
- Entries removed: `4`
- Failures: `0`
- Reclaimed space: `7 KB`

Deleted fixture artifacts:

- stale `buy-11111-disk-monitor-2026-06-10T000000Z` snapshot directory
- stale `buy-11111-disk-state.json`
- stale watchdog verification report
- stale WC-cycle cleanup report
