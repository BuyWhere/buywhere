# BUY-53628 Worker Node Disk-Space Enforcement (WC Cycle Artifact Cleanup)

- Timestamp: `2026-06-19T14:52:31Z`
- Workspace: `/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api`
- Command:

```bash
bash scripts/wc-cycle-cleanup.sh \
  --apply \
  --keep=48 \
  --workspace-dir="$PWD" \
  --alert-pct=90 \
  --log-path="$PWD/reports/BUY-53628-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.log" \
  --report-path="$PWD/reports/BUY-53628-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.json"
```

## Result

- Cleanup completed successfully.
- No stale `cycle-*.ndjson` or `wc-deep-cycle-*.ndjson` artifacts older than `48h` were present in this workspace.
- No files were moved to trash and no prior trash contents were purged.
- Root filesystem remained below the alert threshold after the run.

## Metrics

- `workspace_count`: `0`
- `scanned_count`: `0`
- `moved_count`: `0`
- `purged_count`: `0`
- `reclaimed_kb`: `0`
- `disk_after_pct`: `85`
- `disk_used_kb`: `169756956`
- `disk_free_kb`: `32277716`
- `alert_threshold_pct`: `90`
- `alert_required`: `0`
