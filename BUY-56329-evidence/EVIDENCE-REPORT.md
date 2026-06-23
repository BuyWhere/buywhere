# BUY-56329 Worker Node Disk-Space Enforcement (WC Cycle Artifact Cleanup)

## Summary
Ran `wc-cycle-cleanup.sh --apply --keep=48` in Oracle workspace to remove orphaned WC cycle ndjson files older than 48h. Disk at 67% — well below 90% alert threshold. No alert triggered.

## Before/After

| Metric | Before | After |
|--------|--------|-------|
| Root disk used | 67% (129G / 193G) | 67% (129G / 193G) |
| Cycle files >48h (3ec8f6dd) | 184 | 422* |
| Cycle files moved to trash | 25 (existing) | 443 (existing + new) |
| Zero-byte cycle files | ~30,800 | ~31,200 |
| Disk free | 63.84 GB | 64.05 GB |

*Post-apply count reflects new files aging past the 48h window between scan and report.

## Cleanup Results (Apply Pass)

```json
{
  "ts": "2026-06-23T19:36:08Z",
  "workspace_dir": "/paperclip/instances/default/workspaces/3ec8f6dd-1735-4479-9825-a2c42edac34c",
  "apply": 1,
  "keep_hours": 48,
  "trash_retention_hours": 48,
  "scanned_count": 197,
  "moved_count": 197,
  "purged_count": 0,
  "skipped_open_count": 0,
  "reclaimed_kb": 0,
  "disk_after_pct": 67,
  "alert_threshold_pct": 90,
  "alert_required": 0
}
```

## Key Observations

1. **197 stale cycle files (>48h) moved to trash** — all zero-byte files from the `buy30620-stock` pipeline.
2. **~31,200 zero-byte cycle files remain** (all <48h old, within retention window). The pipeline produces ~30K+ empty cycle files per 48h cycle.
3. **Disk at 67%** — well below 90% alert threshold, stable across watchdog checks.
4. **Trash directory** holds 443 files total. Trash retention is set to 48h; expired trash entries will be auto-purged on subsequent runs.
5. **No open-file conflicts** — `lsof` check found zero in-use cycle files.
6. **Disk watchdog** (BUY-56325/56328) confirms stable free space: 63.83–64.05 GB throughout the run.

## Assessment
The WC cycle artifact cleanup is working as intended. The buy30620-stock cycle pipeline continues to generate large volumes of empty ndjson files that accumulate within the 48h retention window. These zero-byte files do not consume disk space but do consume inodes. The 48h window is sufficient to prevent disk pressure. Disk is healthy at 67% with no alert required.

## Evidence Files
- `dryrun-report.json` — dry run preview (189 files would be trashed)
- `dryrun-log.jsonl` — dry run per-file log
- `apply-report.json` — apply pass report (197 files trashed)
- `apply-log.jsonl` — apply pass per-file log
