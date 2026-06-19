# BUY-53197 safe-data-cleanup sweep

Timestamp: 2026-06-18T23:56:50Z to 2026-06-18T23:58:38Z

## Summary

- Ran a fresh dry-run probe for every workspace root that currently exposes `safe-data-cleanup.sh`.
- Ran a fresh dry-run probe for the single workspace that exposes `safe-canonical-cleanup.sh`.
- No workspace met the routine's `>= 1.00 GB` estimated reclaim threshold, so no `--apply` sweep was run in this heartbeat.
- The largest standard cleanup candidate set was `0.76 GB` in workspace `5bc984ee-e2d2-4312-9e6c-b2864524a21f`; the next largest was `0.41 GB` in `708a8ce4-96dd-409d-94e7-a91d5032e4e0`.
- `/dev/vda1` remains above the routine safety target at `29G` free (`86%` used), so no incident follow-up was needed.

## Disk state

```text
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1       193G  165G   29G  86% /

Filesystem     1024-blocks      Used Available Capacity Mounted on
/dev/vda1        202051056 172489836  29544836      86% /
```

## Workspace dry-run results

```text
0ed653ab-62ba-4deb-8348-3086ab46961c  standard   --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
19dcd635-1d2b-4e41-9950-5865876e12b2  standard   --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=10 apply=0
2e68d8a0-9b0e-4573-8185-323edaabb186  standard   --- files=7 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
3ec8f6dd-1735-4479-9825-a2c42edac34c  standard   --- files=20 freed=0.01GB catalogChecked=0 lowMatchKept=0 r2Missed=58 apply=0
4df23039-272b-4621-9d77-7cf9b7121242  standard   --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
5bc984ee-e2d2-4312-9e6c-b2864524a21f  canonical  --- pass1_ingested=0 pass2_canonical=0 pass3_raw=0 canonical_checked=0 canonical_low_match=0 total_files=0 freed=0.00GB apply=0 trash_dir=data/_trash/2026-06-18 ---
5bc984ee-e2d2-4312-9e6c-b2864524a21f  standard   --- files=200 freed=0.76GB catalogChecked=0 lowMatchKept=0 r2Missed=3 apply=0
708a8ce4-96dd-409d-94e7-a91d5032e4e0  standard   --- files=65 freed=0.41GB catalogChecked=0 lowMatchKept=0 r2Missed=1 apply=0
7fb55262-e658-45e2-88c0-b0e8ccc5ad6c  standard   --- files=12 freed=0.02GB catalogChecked=0 lowMatchKept=0 r2Missed=27 apply=0
a29ac9dc-cf0a-455b-964c-e75bd2f5fc47  standard   --- files=59 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=18 apply=0
bf810416-2f4c-4c4b-b27c-1270ea6f20b3  standard   --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
c2850c54-3396-420a-b7c3-92faae3137c1  standard   --- files=2 freed=0.04GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
d70ff7b3-e26b-4d23-8e05-bfc5d6f7a342  standard   --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
f6a39f3c-210b-479b-a8e7-c78491c120e9  standard   --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
```

## Disposition

- No standard cleanup apply run was performed because every workspace stayed below the `1.00 GB` dry-run trigger.
- No canonical apply run was needed because no standard cleanup candidate set crossed the threshold.
- No `_trash` tarballing was needed because no apply sweep ran in this heartbeat.
- Routine objective remains satisfied because free space is still above the `25 GB` safety margin.
