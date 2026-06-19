# BUY-53252 safe-data-cleanup sweep

Timestamp: 2026-06-19T01:19:16Z to 2026-06-19T01:22:12Z

## Summary

- Ran a fresh dry-run probe for every workspace root currently exposing `safe-data-cleanup.sh`.
- Ran a fresh dry-run probe for the single workspace root exposing `safe-canonical-cleanup.sh`.
- No workspace crossed the routine `>= 1.00 GB` apply threshold from the issue contract.
- The largest standard candidate was `5bc984ee-e2d2-4312-9e6c-b2864524a21f` at `0.85 GB`, so no `safe-data-cleanup.sh --apply --skip-r2 --skip-catalog-check --grace=0 --max-files=300` run was permitted.
- The canonical cleanup dry-run still reported `total_files=0`, so no canonical apply run was warranted.
- Because no apply run happened, there was no new trash payload, no tarball step, and no parent-issue free-space comment for this heartbeat.

## Disk state

```text
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1       193G  170G   23G  89% /

Filesystem     1K-blocks      Used Available Use% Mounted on
/dev/vda1      202051056 177988004  24046668  89% /
```

## Workspace dry-run results

```text
0ed653ab-62ba-4deb-8348-3086ab46961c  standard   status=0    --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
19dcd635-1d2b-4e41-9950-5865876e12b2  standard   status=0    --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=10 apply=0
2e68d8a0-9b0e-4573-8185-323edaabb186  standard   status=0    --- files=8 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
3ec8f6dd-1735-4479-9825-a2c42edac34c  standard   status=0    --- files=3 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=42 apply=0
4df23039-272b-4621-9d77-7cf9b7121242  standard   status=0    --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
5bc984ee-e2d2-4312-9e6c-b2864524a21f  standard   status=0    --- files=194 freed=0.85GB catalogChecked=0 lowMatchKept=0 r2Missed=21 apply=0
708a8ce4-96dd-409d-94e7-a91d5032e4e0  standard   status=0    --- files=66 freed=0.41GB catalogChecked=0 lowMatchKept=0 r2Missed=1 apply=0
7fb55262-e658-45e2-88c0-b0e8ccc5ad6c  standard   status=0    --- files=12 freed=0.02GB catalogChecked=0 lowMatchKept=0 r2Missed=27 apply=0
a29ac9dc-cf0a-455b-964c-e75bd2f5fc47  standard   status=0    --- files=59 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=18 apply=0
bf810416-2f4c-4c4b-b27c-1270ea6f20b3  standard   status=0    --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
c2850c54-3396-420a-b7c3-92faae3137c1  standard   status=0    --- files=2 freed=0.04GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
d70ff7b3-e26b-4d23-8e05-bfc5d6f7a342  standard   status=0    --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
f6a39f3c-210b-479b-a8e7-c78491c120e9  standard   status=0    --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
5bc984ee-e2d2-4312-9e6c-b2864524a21f  canonical  status=0    --- pass1_ingested=0 pass2_canonical=0 pass3_raw=0 canonical_checked=0 canonical_low_match=0 total_files=0 freed=0.00GB apply=0 trash_dir=data/_trash/2026-06-19 ---
```

## Notes

- `/dev/vda1` stayed above the issue's incident threshold because free space remained `24046668 KB` (`23G`), so no new critical `[INCIDENT] workspace disk reclaim needed` issue was opened.
- The host is still below the routine's preferred `25 GB` safety margin, but this heartbeat had no workspace candidate at or above the contract's `1.00 GB` apply threshold to safely reclaim more space.
- The initial fleet probe used a 30-second per-workspace timeout to keep the heartbeat bounded; the largest candidate workspace `5bc984ee-e2d2-4312-9e6c-b2864524a21f` was rerun with a 120-second cap to capture its final footer exactly.
