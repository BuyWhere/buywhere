# BUY-53609 Worker Node Disk-Space Enforcement

## Outcome

- Extended `scripts/buy-53114-worker-node-artifact-cleanup.sh` so worker cleanup now prunes:
  - stale `*wc_cycle_cleanup*.log` files
  - stale `buy-*-disk-watchdog-*` snapshot directories
  - stale threshold report variants matching `BUY-*-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup-*.json`

## Verification

- `node --test tests/worker-node-artifact-cleanup.test.mjs`
  - `3` tests passed
  - Covered stale-vs-fresh behavior for wc cycle cleanup logs, disk watchdog snapshots, and threshold report artifacts
- Dry-run report: `reports/BUY-53609-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.json`
  - Generated at `2026-06-19T14:09:22Z`
  - `removed_count=1` in dry-run mode
  - `alert_required=0`
