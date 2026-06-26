# BUY-57780 Evidence: Worker node disk-space enforcement (WC cycle artifact cleanup)

## Summary
Disk-space enforcement now auto-runs the WC cycle artifact cleanup script before opening a Paperclip incident. Prevents the root filesystem hitting 100% (BUY-30774).

## Stack

### 1. Cleanup script
`scripts/buy-53114-worker-node-artifact-cleanup.sh`
- Prunes orphaned WC cycle ndjson files, stale pid/heartbeat files, old logs, pycache dirs, runs/ artifacts, and disk-monitor artifact dirs.
- Default `--keep=48h` semantics via `DISK_ARTIFACT_RETENTION_DAYS=2` (env-tunable).
- Writes JSON report (`scanned_count`, `removed_count`, `reclaimed_kb`, `alert_required`) to `REPORT_PATH`.

### 2. TypeScript wrapper
`api/src/monitoring/diskSpace.ts:228`
- `ArtifactCleanupResult` interface + `runArtifactCleanup(apply, retentionHours)` function.
- `existsSync` check on script path; 5-min exec timeout; parses JSON report.

### 3. Runner wiring
`api/src/jobs/diskSpaceRunner.ts:54`
- `tick()` calls `runArtifactCleanup(autoApply, retentionHours)` before `createDiskSpaceIncident()`.
- Critical severity -> `autoApply=true` (default; override with `ARTIFACT_CLEANUP_AUTO_APPLY=0`).
- Warning severity -> dry-run only.
- `ARTIFACT_CLEANUP_RETENTION_HOURS` controls retention (default 48h).

## Verification (live, 2026-06-26T08:34:41Z)

Applied run with env vars matching the runner integration:
```bash
ARTIFACT_CLEANUP_REPORT_PATH=/tmp/buy57780_apply_test.json \
WORKSPACES_ROOT=/paperclip/instances/default/workspaces \
APPLY=1 DISK_ARTIFACT_RETENTION_DAYS=2 \
REPORT_PATH=/tmp/buy57780_apply_test.json \
bash scripts/buy-53114-worker-node-artifact-cleanup.sh
```

Report:
```json
{
  "ts": "2026-06-26T08:34:41Z",
  "apply": 1,
  "workspaces_root": "/paperclip/instances/default/workspaces",
  "scanned_count": 18,
  "removed_count": 5,
  "skipped_undeletable_count": 3,
  "failed_count": 0,
  "reclaimed_kb": 5,
  "disk_after_pct": 64,
  "disk_after_kb": 127559708,
  "disk_free_kb": 74474964,
  "alert_threshold_pct": 90,
  "alert_required": 0
}
```

Disk currently at 64% (well under 90% alert threshold); cleanup completes in ~22s; safe-skip path verified for undeletable items.
