# BUY-57776 Evidence: Worker node disk-space enforcement (WC cycle artifact cleanup)

## Summary
Implemented disk-space enforcement for worker nodes by creating cron-triggered WC cycle artifact cleanup scripts.

## What was done

### Scripts Created
1. **scripts/run-buy-57776-worker-wc-cycle-cleanup.sh** - Runner script that executes `wc-cycle-cleanup.sh --apply --keep=48` on the Oracle workspace (3ec8f6dd-1735-4479-9825-a2c42edac34c)
2. **scripts/run-buy-57776-worker-disk-enforcement.sh** - Enforcement script that checks disk usage and triggers cleanup when >80%
3. **scripts/setup-buy-57776-worker-node-disk-space-enforcement.sh** - Idempotent setup script that installs cron entries

### Cron Configuration
- Enforcement check: `*/10 * * * *` (every 10 minutes)
- WC cycle cleanup: `*/30 * * * *` (every 30 minutes)
- Markers: `disk-enforcement-buy-57776-cron` and `wc-cleanup-buy-57776-cron`

## Execution Results

### Initial Run (2026-06-26T08:17:34Z)
- **Workspace**: /paperclip/instances/default/workspaces/3ec8f6dd-1735-4479-9825-a2c42edac34c
- **Disk before**: 63%
- **Disk after**: 63%
- **Files scanned**: 162
- **Files moved to trash**: 162
- **Alert threshold**: 90% (no alert triggered)

### Cleanup Behavior
- Moved 162 stale WC cycle ndjson files (>48h old) from `data/buy30620-stock/` to `_trash/`
- Files are retained in trash for 48 hours before permanent deletion
- Sidecar files (.ingested.json, .summary.json) are also cleaned up

## Verification
```bash
# Check cron entries
crontab -l | grep BUY-57776

# Check logs
cat logs/buy-57776-disk-enforcement.log
cat logs/buy-57776-wc-cycle-enforcement-report.json
```
