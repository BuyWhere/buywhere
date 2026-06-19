# BUY-53296 safe-data-cleanup sweep

Timestamp: 2026-06-19T02:17:00Z to 2026-06-19T02:24:00Z

## Summary

- Enumerated every workspace root under `/paperclip/instances/default/workspaces` with a `safe-data-cleanup.sh`.
- Ran `./safe-data-cleanup.sh --dry-run --skip-r2 --skip-catalog-check --grace=0` in each candidate workspace.
- No workspace reached the `>= 1 GB` apply threshold from the routine instructions, so no `--apply` runs were executed.
- No `_trash` compression was needed because nothing was trashed in this sweep.
- `/dev/vda1` remained above the 25 GB safety margin at the end of the run: `25G` free (`25,219,340` 1K blocks available).

## Dry-run results

| Workspace | Exit | Candidate files | Estimated reclaim |
| --- | --- | ---: | ---: |
| `0ed653ab-62ba-4deb-8348-3086ab46961c` | `1` | 0 | 0.00 GB |
| `19dcd635-1d2b-4e41-9950-5865876e12b2` | `1` | 0 | 0.00 GB |
| `2e68d8a0-9b0e-4573-8185-323edaabb186` | `1` | 8 | 0.00 GB |
| `3ec8f6dd-1735-4479-9825-a2c42edac34c` | `0` | 3 | 0.00 GB |
| `4df23039-272b-4621-9d77-7cf9b7121242` | `1` | 0 | 0.00 GB |
| `5bc984ee-e2d2-4312-9e6c-b2864524a21f` | `0` | 200 | 0.29 GB |
| `708a8ce4-96dd-409d-94e7-a91d5032e4e0` | `0` | 65 | 0.41 GB |
| `7fb55262-e658-45e2-88c0-b0e8ccc5ad6c` | `0` | 12 | 0.02 GB |
| `a29ac9dc-cf0a-455b-964c-e75bd2f5fc47` | `0` | 59 | 0.00 GB |
| `bf810416-2f4c-4c4b-b27c-1270ea6f20b3` | `1` | 0 | 0.00 GB |
| `c2850c54-3396-420a-b7c3-92faae3137c1` | `0` | 2 | 0.04 GB |
| `d70ff7b3-e26b-4d23-8e05-bfc5d6f7a342` | `1` | 0 | 0.00 GB |
| `f6a39f3c-210b-479b-a8e7-c78491c120e9` | `1` | 1 | 0.02 GB |

## Notes

- The largest dry-run estimate was workspace `708a8ce4-96dd-409d-94e7-a91d5032e4e0` at `0.41 GB`, still below the routine's `1 GB` apply gate.
- Several cleanup scripts returned exit code `1` while still emitting a normal summary line. Because every run produced a parseable footer, this sweep used the summary line as the source of truth for candidate count and reclaim estimate.
- Parent issue [BUY-33215] was updated with the current free-space reading after the sweep.
