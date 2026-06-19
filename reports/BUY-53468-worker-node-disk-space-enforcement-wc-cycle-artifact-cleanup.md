# BUY-53468 worker node disk-space enforcement (WC cycle artifact cleanup)

Verified on 2026-06-19.

## Scope

- Executed `scripts/buy-53114-worker-node-artifact-cleanup.sh` in `APPLY=1` mode against `/paperclip/instances/default/workspaces`.
- Captured issue-specific log and JSON report artifacts for this run.

## Command

```bash
REPORT_PATH="$PWD/reports/BUY-53468-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.json" \
APPLY=1 \
bash scripts/buy-53114-worker-node-artifact-cleanup.sh \
  2>&1 | tee "$PWD/reports/BUY-53468-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.log"
```

## Result

- Exit code: `0`
- Worker root scanned: `/paperclip/instances/default/workspaces`
- Entries scanned: `12`
- Files or directories removed: `0`
- Undeletable entries skipped: `5`
- Failures: `0`
- Reclaimed space: `0 KB`
- Root filesystem usage recorded in the cleanup report: `82%`
- Free space recorded in the cleanup report: `37495488 KB`
- Alert threshold: `90%`
- Alert required: `no`

## Notes

- The skipped entries were existing `__pycache__` directories and `.pyc` files in other worker workspaces where the cleanup process did not have delete permission.
- No stale PID files, stale heartbeat files, old `runs/` directories, or old cycle logs were eligible for removal in this pass.
- The threshold-enforcement path stayed healthy: post-cleanup disk usage remained below the configured alert threshold, so the script returned `0`.

## Artifacts

- Markdown report: `reports/BUY-53468-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.md`
- JSON report: `reports/BUY-53468-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.json`
- Execution log: `reports/BUY-53468-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.log`
