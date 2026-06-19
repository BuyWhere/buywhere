# BUY-53719 Worker node disk-space enforcement (WC cycle artifact cleanup)

## Change

- Extended `scripts/buy-53114-worker-node-artifact-cleanup.sh` so stale issue-scoped safe-data cleanup artifacts in workspace `reports/` are now pruned alongside the existing WC cycle cleanup outputs.
- Added coverage for:
  - `BUY-*-dryrun.log`
  - `BUY-*-dryrun-summary.tsv`
  - `BUY-*-safe-data-cleanup-sweep.md`

## Verification

- `node --test tests/worker-node-artifact-cleanup.test.mjs`
  - Passed all 4 tests, including the new stale safe-data cleanup artifact retention case.
- Dry-run:
  - `REPORT_PATH="$PWD/reports/BUY-53719-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.json" bash scripts/buy-53114-worker-node-artifact-cleanup.sh`
  - Reported `removed_count=6`, `failed_count=0`, `alert_required=0`, `disk_after_pct=88`.
- Apply run:
  - `REPORT_PATH="$PWD/reports/BUY-53719-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.json" APPLY=1 bash scripts/buy-53114-worker-node-artifact-cleanup.sh`
  - Removed 1 stale PID file in the current fleet sweep.
  - Skipped 5 undeletable sibling-workspace `__pycache__` paths without failing the run.
  - Final report: `removed_count=1`, `failed_count=0`, `alert_required=0`, `disk_after_pct=88`.

## Artifacts

- `reports/BUY-53719-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.md`
- `reports/BUY-53719-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.json`
- `reports/BUY-53719-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.log`
