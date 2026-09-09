# BUY-58558 Evidence: Worker node disk-space enforcement (WC cycle artifact cleanup)

**Issue:** BUY-58558 — Worker node disk-space enforcement (WC cycle artifact cleanup)
**Executed:** 2026-06-27T20:19:12Z
**Workspace:** /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api
**Script:** `scripts/run-buy-58558-worker-wc-cycle-cleanup.sh`
**Mode:** `--apply --keep=48 --alert-pct=90` across ALL worker workspaces
**Exit code:** 0 (clean, no alert)

## Execution Summary

| Metric | Value |
|--------|-------|
| Disk before | 73% |
| Disk after | 73% |
| Alert threshold | 90% |
| Alert required | No |
| Workspaces scanned (active) | 2 |
| ndjson files scanned | 0 |
| Files moved to trash | 0 |
| Files purged | 0 |
| Reclaimed KB | 0 |
| Root FS | /dev/vda1 193G, 140G used, 53G free |

## Findings

- Enforcement ran `--apply` against all worker workspaces under `/paperclip/instances/default/workspaces` (2 active data dirs: `3ec8f6dd…` with 4930 cycle files, `19dcd635…` with 30 cycle files).
- `scanned_count=0`: every active WC cycle `cycle-*.ndjson` / `wc-deep-cycle-*.ndjson` file is **newer than 48h**, so none are eligible for trashing. The worker is live and producing new cycle files continuously (one every ~7s), and prior cleanup cycles have already moved all >48h artifacts into `_trash/`.
- **0 stale (older than 48h) ndjson files exist outside `_trash/`** — the desired steady state is confirmed.
- Trash-retention purge (`purge_old_trash`) also ran with `--apply`; 0 files purged because all current trash lives under today's date dir (`_trash/2026-06-27/`) which is protected by the `! -path "$TRASH_DIR/*"` guard, and no trash mtime has aged past the 48h retention within unprotected dirs.
- Root filesystem disk usage is **73%**, comfortably below the 90% alert threshold. Root-cause risk (BUY-30774, FS hitting 100%) is not present.

## Conclusion

Disk-space enforcement for WC cycle artifacts is operating correctly. The 48h keep window retains all in-flight worker data, stale artifacts are already in trash, and disk headroom is healthy. No reclaimable space remained this cycle. The BUY-58558 runner script is in place for recurring enforcement.

## Verification

- Enforcement report: `logs/buy-58558-wc-cycle-enforcement-report.json`
- Cleanup JSONL log: `/paperclip/instances/default/workspaces/logs/buy58558_wc_cycle_cleanup_log.jsonl`
- Runner script: `scripts/run-buy-58558-worker-wc-cycle-cleanup.sh`
- Spot-check (zero stale files outside trash):
  `find <workspaces> -path '*/data/*' \( -name 'cycle-*.ndjson' -o -name 'wc-deep-cycle-*.ndjson' \) ! -path '*/_trash/*' -mmin +2880 | wc -l` → 0
