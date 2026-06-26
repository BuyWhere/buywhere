# BUY-57953 Evidence: Worker node WC cycle artifact cleanup enforcement

## Summary
BUY-57953 runs WC cycle artifact cleanup on the Oracle worker workspace to prevent disk space from hitting 100% (BUY-30774).

## Run Details
- **Issue**: BUY-57953
- **Workspace**: Oracle (`/paperclip/instances/default/workspaces/3ec8f6dd-1735-4479-9825-a2c42edac34c`)
- **Script**: `scripts/run-buy-57953-worker-wc-cycle-cleanup.sh`
- **Keep hours**: 48
- **Alert threshold**: 90%

## Results
- **Scanned**: 91 stale cycle ndjson files
- **Moved to trash**: 91 files
- **Disk before**: 67%
- **Disk after**: 67%
- **Alert required**: No (disk below 90% threshold)

## Key Artifacts
- Report: `logs/buy-57953-wc-cycle-enforcement-report.json`
- Cleanup log: `/paperclip/instances/default/workspaces/3ec8f6dd-1735-4479-9825-a2c42edac34c/data/_wc_cleanup_log.jsonl`

## Verification
```bash
# Run the enforcement script
bash scripts/run-buy-57953-worker-wc-cycle-cleanup.sh

# Check the report
cat logs/buy-57953-wc-cycle-enforcement-report.json
```
