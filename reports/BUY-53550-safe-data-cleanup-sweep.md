# BUY-53550 safe-data-cleanup sweep

Timestamp: 2026-06-19T12:10:49Z
Date: 2026-06-19

## Summary

- No new issue-thread comment was included in the wake payload; the assignment itself triggered this sweep.
- Enumerated every workspace root under `/paperclip/instances/default/workspaces` that exposes `safe-data-cleanup.sh`.
- Ran `./safe-data-cleanup.sh --dry-run --skip-r2 --skip-catalog-check --grace=0` in all 13 candidate workspaces.
- No workspace reached the `>= 1 GB` threshold required for `--apply`, so no files were moved into `data/_trash/2026-06-19/`.
- Because nothing was trashed, no `safe-canonical-cleanup.sh --apply` runs or `_trash` archive compaction steps were eligible this heartbeat.
- `/dev/vda1` remained above the 25 GB safety margin after the sweep: `35G` free (`36,251,428` 1K blocks / `37,121,462,272` bytes available).

## Dry-run results

| Workspace | Candidate files | Estimated reclaim |
| --- | ---: | ---: |
| `0ed653ab-62ba-4deb-8348-3086ab46961c` | 0 | 0.00 GB |
| `19dcd635-1d2b-4e41-9950-5865876e12b2` | 0 | 0.00 GB |
| `2e68d8a0-9b0e-4573-8185-323edaabb186` | 12 | 0.00 GB |
| `3ec8f6dd-1735-4479-9825-a2c42edac34c` | 5 | 0.19 GB |
| `4df23039-272b-4621-9d77-7cf9b7121242` | 2 | 0.00 GB |
| `5bc984ee-e2d2-4312-9e6c-b2864524a21f` | 13 | 0.05 GB |
| `708a8ce4-96dd-409d-94e7-a91d5032e4e0` | 66 | 0.41 GB |
| `7fb55262-e658-45e2-88c0-b0e8ccc5ad6c` | 13 | 0.02 GB |
| `a29ac9dc-cf0a-455b-964c-e75bd2f5fc47` | 62 | 0.94 GB |
| `bf810416-2f4c-4c4b-b27c-1270ea6f20b3` | 0 | 0.00 GB |
| `c2850c54-3396-420a-b7c3-92faae3137c1` | 16 | 0.08 GB |
| `d70ff7b3-e26b-4d23-8e05-bfc5d6f7a342` | 0 | 0.00 GB |
| `f6a39f3c-210b-479b-a8e7-c78491c120e9` | 2 | 0.03 GB |

## Notes

- The largest dry-run estimate was workspace `a29ac9dc-cf0a-455b-964c-e75bd2f5fc47` at `0.94 GB`, still below the routine's apply gate.
- Since no workspace qualified for mutation, this heartbeat intentionally made no data changes inside any workspace and left no new `_trash` trees to compress.
- Parent issue [BUY-33215] should receive the current free-space reading after this sweep: `37,121,462,272` bytes available on `/dev/vda1`.
