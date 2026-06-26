# BUY-58029 Evidence: Worker node disk-space enforcement (WC cycle artifact cleanup)

## Summary
BUY-58029 routine enforcement heartbeat for BUY-30774 worker node root filesystem cap. Ran `wc-cycle-cleanup.sh --apply --keep=48` across all worker workspaces to delete orphaned WC cycle ndjson files older than 48h.

## Results
- **Workspace count**: 2
- **Scanned (stale > 48h)**: 115 files
- **Moved to trash**: 115 files
- **Purged (trash retention expired)**: 0
- **Skipped (open files)**: 0
- **Reclaimed**: 0 KB (all trashed ndjson were already zero-byte from prior cleanup cycles)
- **Disk before**: 68% (130G used / 193G total)
- **Disk after**: 68% (135G used / 193G total)
- **Alert required**: No (disk 68%, well below 90% threshold)

## Workspaces Touched
- `/paperclip/instances/default/workspaces/3ec8f6dd-1735-4479-9825-a2c42edac34c` — buy30620-stock
- `/paperclip/instances/default/workspaces/19dcd635-1d2b-4e41-9950-5865876e12b2` — buy55703-nonshopify

## Evidence
- Apply report: `/tmp/buy58029_wc_cleanup_report.json`
- Cleanup utility: `scripts/wc-cycle-cleanup.sh`
