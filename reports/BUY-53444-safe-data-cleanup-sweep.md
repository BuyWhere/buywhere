# BUY-53444 safe-data-cleanup sweep

Timestamp: 2026-06-19T08:05:18Z to 2026-06-19T08:09:30Z

## Summary

- Enumerated every workspace root under `/paperclip/instances/default/workspaces` with `safe-data-cleanup.sh` and ran the required dry-run probe with `--skip-r2 --skip-catalog-check --grace=0`.
- No workspace crossed the routine `>= 1.00 GB` apply threshold, so no `safe-data-cleanup.sh --apply` run was permitted this heartbeat.
- No workspace created fresh `_trash/2026-06-19/` data from this sweep, so there was nothing to compress with `tar.gz`.
- `/dev/vda1` ended the run at `34G` free (`35,957,616,640` bytes available), which stays above both the `25 GB` safety margin and the `20 GB` incident threshold.

## Disk State

```text
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1       193G  160G   34G  83% /

Filesystem        1B-blocks         Used   Available Use% Mounted on
/dev/vda1      206900281344 170925887488 35957616640  83% /
```

## Workspace Dry-Run Results

```text
0ed653ab-62ba-4deb-8348-3086ab46961c  status=1  --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
19dcd635-1d2b-4e41-9950-5865876e12b2  status=1  --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=9 apply=0
2e68d8a0-9b0e-4573-8185-323edaabb186  status=1  --- files=12 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
3ec8f6dd-1735-4479-9825-a2c42edac34c  status=1  --- files=5 freed=0.19GB catalogChecked=0 lowMatchKept=0 r2Missed=42 apply=0
4df23039-272b-4621-9d77-7cf9b7121242  status=1  --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
5bc984ee-e2d2-4312-9e6c-b2864524a21f  status=1  --- files=200 freed=0.27GB catalogChecked=0 lowMatchKept=0 r2Missed=3 apply=0
708a8ce4-96dd-409d-94e7-a91d5032e4e0  status=0  --- files=65 freed=0.41GB catalogChecked=0 lowMatchKept=0 r2Missed=1 apply=0
7fb55262-e658-45e2-88c0-b0e8ccc5ad6c  status=1  --- files=13 freed=0.02GB catalogChecked=0 lowMatchKept=0 r2Missed=27 apply=0
a29ac9dc-cf0a-455b-964c-e75bd2f5fc47  status=0  --- files=61 freed=0.94GB catalogChecked=0 lowMatchKept=0 r2Missed=20 apply=0
bf810416-2f4c-4c4b-b27c-1270ea6f20b3  status=1  --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
c2850c54-3396-420a-b7c3-92faae3137c1  status=0  --- files=5 freed=0.05GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
d70ff7b3-e26b-4d23-8e05-bfc5d6f7a342  status=1  --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
f6a39f3c-210b-479b-a8e7-c78491c120e9  status=1  --- files=2 freed=0.03GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
```

## Notes

- The largest dry-run candidate was `a29ac9dc-cf0a-455b-964c-e75bd2f5fc47` at `0.94 GB`, which remained below the `1 GB` apply gate, so the routine correctly became a no-op.
- Several cleanup scripts exited with status `1` while still emitting a normal summary footer. The footer remained parseable in every case, so this sweep used that footer as the source of truth for candidate counts and reclaim estimates.
- Parent issue [BUY-33215] should receive the current free-space reading after this sweep: `35,957,616,640` bytes available on `/dev/vda1`.
