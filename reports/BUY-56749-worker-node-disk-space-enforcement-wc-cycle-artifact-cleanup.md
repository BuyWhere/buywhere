# BUY-56749: Worker node disk-space enforcement (WC cycle artifact cleanup)

**Date:** 2026-06-24T09:58:16Z
**Status:** Complete ✅

## Summary

Worker node disk-space enforcement via WC cycle artifact cleanup ran successfully. The cleanup script (`wc-cycle-cleanup.sh --apply --keep=48`) scanned all worker workspaces under `/paperclip/instances/default/workspaces`, deleting 3,375 orphaned WC cycle ndjson files older than 48 hours. Disk usage is at 66%, well below the 90% alert threshold.

This is a recurring maintenance task preventing the root filesystem from hitting 100% (parent: BUY-30774).

## Run Results

| Metric | Value |
|--------|-------|
| Disk after cleanup | 66% |
| Disk used | ~125 GB |
| Disk free | ~67 GB |
| Alert threshold | 90% |
| Alert required | No |
| Workspaces scanned | 68 |
| Candidates (dryrun) | 3,328 |
| Files removed (apply) | 3,375 |
| Skipped (younger than 48h) | 30,583 |
| Failed deletions | 0 |
| Reclaimed | 0 KB (all candidates were 0-byte empties) |

## Timing

| Phase | Started | Ended | Duration |
|-------|---------|-------|----------|
| Dryrun | 2026-06-24T09:51:33Z | 2026-06-24T09:54:28Z | ~3 min |
| Apply  | 2026-06-24T09:54:55Z | 2026-06-24T09:58:16Z | ~3.5 min |
| **Total** | | | **~7 min** |

The previous heartbeat (run `5b19f2ef`) hit the 600s harness wall-clock during post-run bookkeeping even though both phases completed. This heartbeat verified the on-disk artifacts, re-checked disk, and recorded the final disposition.

## Interpretation

3,375 stale cycle ndjson files (`cycle-*.ndjson`, `cycle-*.ndjson.empty`, `cycle-*.ndjson.ingested.json`) older than 48 hours were found across all 68 worker workspaces and deleted in apply mode. All candidates were 0-byte empties (likely incomplete/aborted ingest cycles), matching the BUY-56733 sibling run. No deletions failed, no alert triggered. Disk usage held at 66%.

## Implementation

- **Core cleanup:** `scripts/wc-cycle-cleanup.sh --apply --keep=48`
- **Alert threshold:** 90% disk usage
- **Keep window:** 48 hours
- **Mode:** apply (deletion, not trash — current script does irreversible rm; the older reversible-trash variant lives in `scripts/buy-53114-worker-node-artifact-cleanup.sh` and is not used by this issue)
- **Evidence:** `BUY-56749-evidence/{dryrun,apply}-report.json`, `proof.txt`
