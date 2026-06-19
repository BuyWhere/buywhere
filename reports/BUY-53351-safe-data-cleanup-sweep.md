# BUY-53351 safe-data-cleanup sweep

Timestamp: 2026-06-19T04:54:29Z to 2026-06-19T05:02:32Z

## Summary

- Enumerated every workspace root under `/paperclip/instances/default/workspaces` that currently exposes `safe-data-cleanup.sh` and ran the required dry-run probe with `--skip-r2 --skip-catalog-check --grace=0`.
- Ran the companion dry-run for the single workspace root exposing `safe-canonical-cleanup.sh`.
- No workspace crossed the routine `>= 1.00 GB` apply threshold, so no `safe-data-cleanup.sh --apply --skip-r2 --skip-catalog-check --grace=0 --max-files=300` run was permitted this heartbeat.
- The largest completed standard dry-run candidate was `708a8ce4-96dd-409d-94e7-a91d5032e4e0` at `0.41 GB`; the canonical cleanup candidate remained `0.00 GB`.
- `/dev/vda1` remained above the routine safety margin at `38G` free (`39,774,160` 1K blocks available), so there was no need to open a new critical reclaim incident.

## Disk State

```text
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1       193G  155G   38G  81% /

Filesystem     1K-blocks      Used Available Use% Mounted on
/dev/vda1      202051056 162260512  39774160  81% /
```

## Workspace Dry-Run Results

```text
0ed653ab-62ba-4deb-8348-3086ab46961c  standard   status=1    --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
19dcd635-1d2b-4e41-9950-5865876e12b2  standard   status=1    --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=9 apply=0
2e68d8a0-9b0e-4573-8185-323edaabb186  standard   status=1    --- files=8 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
3ec8f6dd-1735-4479-9825-a2c42edac34c  standard   status=1    --- files=5 freed=0.19GB catalogChecked=0 lowMatchKept=0 r2Missed=42 apply=0
4df23039-272b-4621-9d77-7cf9b7121242  standard   status=1    --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
5bc984ee-e2d2-4312-9e6c-b2864524a21f  standard   status=124  no-parseable-summary
708a8ce4-96dd-409d-94e7-a91d5032e4e0  standard   status=0    --- files=65 freed=0.41GB catalogChecked=0 lowMatchKept=0 r2Missed=1 apply=0
7fb55262-e658-45e2-88c0-b0e8ccc5ad6c  standard   status=1    --- files=12 freed=0.02GB catalogChecked=0 lowMatchKept=0 r2Missed=27 apply=0
a29ac9dc-cf0a-455b-964c-e75bd2f5fc47  standard   status=0    --- files=59 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=20 apply=0
bf810416-2f4c-4c4b-b27c-1270ea6f20b3  standard   status=1    --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
c2850c54-3396-420a-b7c3-92faae3137c1  standard   status=0    --- files=3 freed=0.04GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
d70ff7b3-e26b-4d23-8e05-bfc5d6f7a342  standard   status=1    --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
f6a39f3c-210b-479b-a8e7-c78491c120e9  standard   status=1    --- files=1 freed=0.03GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
5bc984ee-e2d2-4312-9e6c-b2864524a21f  canonical  status=0    --- pass1_ingested=0 pass2_canonical=0 pass3_raw=0 canonical_checked=1 canonical_low_match=1 total_files=0 freed=0.00GB apply=0 trash_dir=data/_trash/2026-06-19 ---
```

## Notes

- `5bc984ee-e2d2-4312-9e6c-b2864524a21f` standard dry-run timed out again after `120s` without a parseable summary. The latest completed same-day fleet baseline in [BUY-53339](./BUY-53339-safe-data-cleanup-sweep.md) also kept it below the apply gate, and the last completed standard dry-run cited there remained `0.28 GB`, so no threshold exception was justified.
- Because no workspace crossed the threshold, there was no apply run, no new `_trash` payload requiring tarball compaction, and no direct reclaim to report from this heartbeat.
- Parent issue [BUY-33215] should receive the current free-space reading after this sweep: `39,774,160` 1K blocks available on `/dev/vda1`.
