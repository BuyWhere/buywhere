# BUY-53742 worker node disk-space enforcement (WC cycle artifact cleanup)

Verified on 2026-06-19.

## Action

- Executed `scripts/buy-53114-worker-node-artifact-cleanup.sh` with `APPLY=1` against `/paperclip/instances/default/workspaces`.
- Wrote the machine-readable report to `reports/BUY-53742-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.json`.
- Captured the cleanup log at `reports/BUY-53742-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.log`.
- Re-ran the focused regression suite with `node --test tests/worker-node-artifact-cleanup.test.mjs`.

## Results

- Cleanup exit code: `0`
- Targeted test result: `4/4` passing
- Entries scanned: `10`
- Entries removed: `0`
- Skipped undeletable entries: `5`
- Failures: `0`
- Reclaimed space: `0 KB`
- Disk usage after cleanup: `87%`
- Alert threshold: `90%`
- Alert raised: `no`
- Free space before cleanup: `28,124,524 KB` (`26.82 GiB`)
- Free space after cleanup: `28,123,832 KB` (`26.82 GiB`)
- Delta during run: `-692 KB`

## Notes

- No additional stale WC-cycle, watchdog, threshold-report, or safe-data cleanup artifacts were eligible for deletion in this pass.
- The only remaining candidates encountered were undeletable Python cache paths under other workspaces, which were skipped safely and did not produce a hard failure.
- Host free space remains above the `25 GiB` warning floor after this verification pass.
