# BUY-53489 worker node disk-space enforcement (WC cycle artifact cleanup)

Verified on 2026-06-19.

## Summary

- Ran `scripts/wc-cycle-cleanup.sh --apply --keep=48` against `/paperclip/instances/default/workspaces`.
- The cleanup completed successfully and did not trigger the 90% disk alert threshold.
- No stale WC cycle artifacts older than 48 hours were present, so no files were moved to `_trash` in this run.

## Verification

1. Syntax check passed:
   - `bash -n scripts/wc-cycle-cleanup.sh`
2. Fleet-wide cleanup run:
   - report artifact: `reports/BUY-53489-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.json`
   - runtime log: `logs/buy53489_wc_cycle_cleanup.log`
3. Post-run report values:
   - `workspace_count=2`
   - `scanned_count=0`
   - `moved_count=0`
   - `purged_count=0`
   - `reclaimed_kb=0`
   - `disk_after_pct=84`
   - `alert_required=0`
4. Focused fleet check for actual WC cycle targets:
   - `find /paperclip/instances/default/workspaces -type f \( -name 'cycle-*.ndjson' -o -name 'wc-deep-cycle-*.ndjson' \) ! -path '*/_trash/*' | wc -l` returned `607`
   - the same search with `-mmin +2880` returned no matches, confirming there were no WC cycle files older than 48 hours to remove

## Outcome

BUY-53489 is complete for this heartbeat. The cleanup command was executed with `--apply`, disk usage remained below the alert threshold, and there was nothing eligible for deletion under the WC cycle retention policy.
