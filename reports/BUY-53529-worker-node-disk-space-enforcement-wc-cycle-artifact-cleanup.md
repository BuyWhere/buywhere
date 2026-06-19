# BUY-53529 worker node disk-space enforcement (WC cycle artifact cleanup)

Verified on 2026-06-19.

## Regression fixed

- Restored the `_trash` archive compaction path in `scripts/buy-53114-worker-node-artifact-cleanup.sh`.
- Rewired the watchdog cron wrapper in `scripts/run-buy-52997-disk-watchdog-cron.sh` to pass the trash-archive retention knobs.
- This closes the regression where mature `data/_trash/<date>/` directories were no longer compacted into `data/_trash_archives/<date>.tar.gz`, reducing real disk reclamation on worker nodes.

## Verification

- Syntax:
  - `bash -n scripts/buy-53114-worker-node-artifact-cleanup.sh`
  - `bash -n scripts/run-buy-52997-disk-watchdog-cron.sh`
- Apply run:

```bash
REPORT_PATH="$PWD/reports/BUY-53529-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.json" \
APPLY=1 \
TRASH_ARCHIVE_MINUTES=360 \
TRASH_ARCHIVE_MIN_KB=1 \
bash scripts/buy-53114-worker-node-artifact-cleanup.sh \
  2>&1 | tee "$PWD/reports/BUY-53529-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.log"
```

## Result

- Exit code: `0`
- Entries scanned: `11`
- Archived stale `_trash` date directories: `2`
- Undeletable entries skipped: `5`
- Failures: `0`
- Net reclaimed space: `16,415 KB`
- Post-run filesystem state:
  - `disk_after_pct=82`
  - `disk_free_kb=37070404`
  - `alert_required=0`

## Archived paths

- `/paperclip/instances/default/workspaces/a29ac9dc-cf0a-455b-964c-e75bd2f5fc47/data/_trash/2026-06-18`
  - `dir_kb=17196`
  - `archive_kb=2775`
  - `reclaimed_kb=14421`
- `/paperclip/instances/default/workspaces/708a8ce4-96dd-409d-94e7-a91d5032e4e0/data/_trash/2026-06-18`
  - `dir_kb=2816`
  - `archive_kb=822`
  - `reclaimed_kb=1994`

## Artifacts

- Markdown report: `reports/BUY-53529-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.md`
- JSON report: `reports/BUY-53529-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.json`
- Execution log: `reports/BUY-53529-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.log`
