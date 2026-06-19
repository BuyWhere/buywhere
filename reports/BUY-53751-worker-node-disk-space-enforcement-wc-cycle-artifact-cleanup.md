# BUY-53751 Worker node disk-space enforcement (WC cycle artifact cleanup)

- Executed `scripts/wc-cycle-cleanup.sh --apply --keep=48 --workspace-dir="$PWD" --alert-pct=90` on `2026-06-19T18:40:16Z`.
- Wrote the threshold report to `reports/BUY-53751-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup-threshold.json`.
- No eligible `cycle-*.ndjson` or `wc-deep-cycle-*.ndjson` files older than 48 hours were present in this workspace during the run.

## Result snapshot

- `workspace_count`: `0`
- `scanned_count`: `0`
- `moved_count`: `0`
- `purged_count`: `0`
- `reclaimed_kb`: `0`
- `disk_after_pct`: `87`
- `disk_free_kb`: `28012100`
- `alert_required`: `0`

## Verification

- `bash -n scripts/wc-cycle-cleanup.sh`
- `bash scripts/wc-cycle-cleanup.sh --apply --keep=48 --workspace-dir="$PWD" --alert-pct=90 --log-path="$PWD/reports/BUY-53751-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.jsonl" --report-path="$PWD/reports/BUY-53751-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup-threshold.json"`
