# BUY-53730 worker node disk-space enforcement (WC cycle artifact cleanup)

Verified on 2026-06-19.

## Action

- Executed `scripts/buy-53114-worker-node-artifact-cleanup.sh` in `APPLY=1` mode against `/paperclip/instances/default/workspaces`.
- Wrote the machine-readable report to `reports/BUY-53730-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.json`.
- Re-ran the focused regression suite with `node --test tests/worker-node-artifact-cleanup.test.mjs`.

## Results

- Cleanup exit code: `0`
- Targeted test result: `4/4` passing
- Entries scanned: `11`
- Entries removed: `0`
- Skipped undeletable entries: `5`
- Failures: `1`
- Reclaimed space: `0 KB`
- Disk usage after cleanup: `87%`
- Alert threshold: `90%`
- Alert raised: `no`

## Notes

- The single failure was an attempted archive of `/paperclip/instances/default/workspaces/5bc984ee-e2d2-4312-9e6c-b2864524a21f/data/_trash/2026-06-19`.
- Immediate repro showed the `_trash` path no longer existed, so the failure appears to have been caused by a concurrent removal/move rather than a persistent permission or disk-space problem.
- No additional stale WC-cycle or worker-artifact files were present for deletion during this routine pass.
