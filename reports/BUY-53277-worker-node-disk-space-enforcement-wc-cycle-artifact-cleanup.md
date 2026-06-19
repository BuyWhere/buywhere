# BUY-53277 worker node disk-space enforcement (WC cycle artifact cleanup)

Verified on 2026-06-19.

## Summary

- Fixed a worker cleanup edge case in `scripts/buy-53114-worker-node-artifact-cleanup.sh`.
- The script was deleting empty directories with `find ... -delete`, which could remove `WORKSPACES_ROOT` itself in a fully-clean temporary fixture before `write_report()` ran.
- `write_report()` now falls back to the parent directory if `WORKSPACES_ROOT` no longer exists, and empty-directory pruning now uses `-mindepth 1` so the root is preserved.

## Verification

1. Syntax check passed:
   - `bash -n scripts/buy-53114-worker-node-artifact-cleanup.sh`
2. Focused temp-workspace cleanup passed:
   - Removed stale `*.pid`, `*.heartbeat`, `logs/worker-old.log`, `runs/old-run`, and `scripts/__pycache__`
   - Preserved the temp `WORKSPACES_ROOT`
   - Wrote a valid report with disk metrics instead of blank `df` fields
3. Disk-threshold contract still holds:
   - `ALERT_PCT=100` returned `0`
   - `ALERT_PCT=0` returned `10` and wrote `"alert_required": 1`
4. Direct WC-cycle cleanup run on the current workspace passed:
   - `reports/BUY-53277-wc-cycle-cleanup.json` recorded `scanned_count=0`, `moved_count=0`, `alert_required=0`

## Artifacts

- `reports/BUY-53277-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.json`
- `reports/BUY-53277-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup-threshold.json`
- `reports/BUY-53277-wc-cycle-cleanup.json`
