# BUY-53570 worker node disk-space enforcement (WC cycle artifact cleanup)

Verified on 2026-06-19.

## Summary

- Ran `scripts/wc-cycle-cleanup.sh --apply --keep=48 --workspace-dir="$PWD" --alert-pct=90` in `/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api`.
- The cleanup completed successfully and stayed below the `90%` disk alert threshold.
- No WC cycle artifacts older than 48 hours were present in this workspace, so nothing was moved into `_trash` and no retention purge was needed.

## Verification

1. Syntax check passed:
   - `bash -n scripts/wc-cycle-cleanup.sh`
2. Cleanup run completed with issue-specific JSON output:
   - report artifact: `reports/BUY-53570-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.json`
3. Post-run report values:
   - `workspace_count=1`
   - `scanned_count=0`
   - `moved_count=0`
   - `purged_count=0`
   - `reclaimed_kb=0`
   - `disk_after_pct=83`
   - `alert_required=0`
4. Workspace checks after the run:
   - `find "$PWD" -type f \( -name 'cycle-*.ndjson' -o -name 'wc-deep-cycle-*.ndjson' \) ! -path '*/_trash/*' | wc -l` returned `603`
   - the same search with `-mmin +2880` returned `0`, confirming there were no stale WC cycle files older than 48 hours

## Outcome

BUY-53570 is complete for this heartbeat. The WC cycle cleanup ran in apply mode, produced the attached JSON report, and confirmed that this workspace had no artifacts eligible for retention cleanup while disk usage remained under the configured alert threshold.
