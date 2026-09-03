# BUY-58075 — Workspace disk cleanup (safe-data-cleanup sweep)

## Sweep result: SKIP (below 1 GB threshold)

Total estimated reclaimable across all 14 candidate workspaces: **0.95 GB** — below the 1 GB apply threshold from the runbook. No `--apply` run executed this sweep.

## Disk status
- **Disk:** 131G used / 62G free / 193G total (68% used)
- **Safety margin:** 62GB free (well above 25GB target)

## Cross-workspace dry-run results

| Workspace | GB | files |
|-----------|---:|------:|
| 5bc984ee-e2d2-4312-9e6c-b2864524a21f | 0.89 | 248 |
| 2e68d8a0-9b0e-4573-8185-323edaabb186 | 0.06 | 34 |
| 0ed653ab-62ba-4deb-8348-3086ab46961c | 0.00 | 0 |
| 19dcd635-1d2b-4e41-9950-5865876e12b2 | 0.00 | 0 |
| 3ec8f6dd-1735-4479-9825-a2c42edac34c | 0.00 | 0 |
| 4df23039-272b-4621-9d77-7cf9b7121242 | 0.00 | 0 |
| 58e11b02-c880-4823-ba74-2764997f70db | 0.00 | 0 |
| 708a8ce4-96dd-409d-94e7-a91d5032e4e0 | 0.00 | 0 |
| 7fb55262-e658-45e2-88c0-b0e8ccc5ad6c | 0.00 | 0 |
| a29ac9dc-cf0a-455b-964c-e75bd2f5fc47 | 0.00 | 0 |
| bf810416-2f4c-4c4b-b27c-1270ea6f20b3 | 0.00 | 0 |
| c2850c54-3396-420a-b7c3-92faae3137c1 | 0.00 | 0 |
| d70ff7b3-e26b-4d23-8e05-bfc5d6f7a342 | 0.00 | 0 |
| f6a39f3c-210b-479b-a8e7-c78491c120e9 | 0.00 | 0 |
| **Total** | **0.95** | **282** |

## Decision
- No workspace exceeded the 1 GB apply threshold.
- Skipped `safe-data-cleanup.sh --apply` per runbook rule.
- Skipped `safe-canonical-cleanup.sh` (no apply trigger).
- Skipped tar+gzip step (no trashed data, total < 4 GB).

## Local workspace (476c8023) — already clean
- No `safe-data-cleanup.sh` in this workspace root; sweep coverage is via shared script in neighbor workspaces.
- Local cleanup: removed `scrapers/__pycache__/` and empty stale node_modules dirs in previous run (BUY-58075 first heartbeat).
- BUY-58069 worker-node disk-space enforcement cron installed (`*/10 * * * *`, enforce at 85%, critical at 95%).

## Safety verification
- 17 workspace dirs evaluated (14 with safe-data-cleanup.sh, 3 without)
- All commands run with --dry-run only — no data moved or deleted
- Disk safety margin remains 62GB free (37GB above 25GB target)
- Run log retained at `/tmp/buy-58075-sweep-20260626T230452Z/dryrun.log`
