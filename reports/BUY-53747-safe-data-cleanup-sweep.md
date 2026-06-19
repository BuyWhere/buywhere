# BUY-53747 safe-data-cleanup sweep

Timestamp: 2026-06-19T18:22:44Z
Date: 2026-06-19

## Summary

- No new issue-thread comment was included in the wake payload; the assignment itself triggered this sweep.
- Enumerated every workspace root under `/paperclip/instances/default/workspaces` that currently exposes `safe-data-cleanup.sh`, plus the one workspace that also exposes `safe-canonical-cleanup.sh`.
- Ran `timeout 180s ./safe-data-cleanup.sh --dry-run --skip-r2 --skip-catalog-check --grace=0` in all 13 candidate workspaces and captured issue-local logs under `reports/BUY-53747-*-dryrun.log`.
- Ran `timeout 180s ./safe-canonical-cleanup.sh --dry-run --skip-r2 --skip-catalog-check --grace=0` in the single workspace that exposes it and captured `reports/BUY-53747-5bc984ee-e2d2-4312-9e6c-b2864524a21f-canonical-dryrun.log`.
- No workspace reached the routine `>= 1 GB` apply gate, so no `safe-data-cleanup.sh --apply` runs were permitted.
- Because no workspace was eligible for apply, no `safe-canonical-cleanup.sh --apply` or `_trash` archive compaction step was eligible either.
- `/dev/vda1` ended the sweep above the preferred `25 GB` safety margin and above the `20 GB` incident threshold: `27G` free (`28,065,556` 1K blocks available).

## Dry-run Results

| Workspace | Candidate files | Estimated reclaim |
| --- | ---: | ---: |
| `0ed653ab-62ba-4deb-8348-3086ab46961c` | 0 | 0.00 GB |
| `19dcd635-1d2b-4e41-9950-5865876e12b2` | 0 | 0.00 GB |
| `2e68d8a0-9b0e-4573-8185-323edaabb186` | 12 | 0.00 GB |
| `3ec8f6dd-1735-4479-9825-a2c42edac34c` | 5 | 0.19 GB |
| `4df23039-272b-4621-9d77-7cf9b7121242` | 2 | 0.00 GB |
| `5bc984ee-e2d2-4312-9e6c-b2864524a21f` | 200 | 0.36 GB |
| `708a8ce4-96dd-409d-94e7-a91d5032e4e0` | 66 | 0.41 GB |
| `7fb55262-e658-45e2-88c0-b0e8ccc5ad6c` | 13 | 0.02 GB |
| `a29ac9dc-cf0a-455b-964c-e75bd2f5fc47` | 62 | 0.94 GB |
| `bf810416-2f4c-4c4b-b27c-1270ea6f20b3` | 0 | 0.00 GB |
| `c2850c54-3396-420a-b7c3-92faae3137c1` | 42 | 0.63 GB |
| `d70ff7b3-e26b-4d23-8e05-bfc5d6f7a342` | 0 | 0.00 GB |
| `f6a39f3c-210b-479b-a8e7-c78491c120e9` | 3 | 0.03 GB |

## Totals

- Workspaces with `safe-data-cleanup.sh`: 13
- Workspaces with `safe-canonical-cleanup.sh`: 1
- Total dry-run candidates: 405 files
- Total estimated reclaim across all workspaces: 2.58 GB
- Workspaces above 1 GB dry-run threshold: 0
- Workspaces applied: 0
- Workspaces with canonical apply: 0
- Trash trees compressed: 0
- Incidents opened: 0

## Disk State

```text
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1       193G  166G   27G  87% /

Filesystem     1024-blocks      Used Available Capacity Mounted on
/dev/vda1        202051056 173969116  28065556      87% /
```

## Notes

- The largest candidate set stayed below the mutation gate: workspace `a29ac9dc-cf0a-455b-964c-e75bd2f5fc47` at `0.94 GB`.
- Workspace `5bc984ee-e2d2-4312-9e6c-b2864524a21f` still hit the script's `MAX_FILES` cap during dry-run, but the capped estimate remained below the apply threshold at `0.36 GB`.
- The single canonical dry-run reported `0` candidates, so there was no canonical follow-on work even if the standard gate had opened.
- This heartbeat intentionally left all workspaces unchanged because the sweep never crossed the routine apply threshold.
- Durable evidence for this run lives in `reports/BUY-53747-dryrun-summary.tsv` and `reports/BUY-53747-*-dryrun.log`.
