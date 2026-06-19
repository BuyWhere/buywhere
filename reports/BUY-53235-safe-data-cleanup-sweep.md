# BUY-53235 safe-data-cleanup sweep

Timestamp: 2026-06-19T00:45:54Z to 2026-06-19T00:50:24Z

## Summary

- Ran a fresh dry-run probe for every workspace root currently exposing `safe-data-cleanup.sh`.
- Ran a fresh dry-run probe for the single workspace root exposing `safe-canonical-cleanup.sh`.
- One workspace crossed the routine `>= 1.00 GB` trigger: `5bc984ee-e2d2-4312-9e6c-b2864524a21f` at `1.13 GB`.
- Ran `./safe-data-cleanup.sh --apply --skip-r2 --skip-catalog-check --grace=0 --max-files=300` in that workspace only.
- The apply run trashed `200` files and reported `freed=1.13GB`.
- No canonical cleanup apply run was warranted because the only canonical root reported `total_files=0`.
- Total new trash stayed below the `4 GB` tarball threshold, so no `tar.gz` archive or parent-issue free-space comment was required by the runbook.

## Disk state

```text
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1       193G  170G   24G  88% /

Filesystem     1K-blocks      Used Available Use% Mounted on
/dev/vda1      202051056 177705828  24328844  88% /
```

## Workspace dry-run results

```text
0ed653ab-62ba-4deb-8348-3086ab46961c  standard   status=1    --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
19dcd635-1d2b-4e41-9950-5865876e12b2  standard   status=1    --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=10 apply=0
2e68d8a0-9b0e-4573-8185-323edaabb186  standard   status=1    --- files=8 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
3ec8f6dd-1735-4479-9825-a2c42edac34c  standard   status=0    --- files=3 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=42 apply=0
4df23039-272b-4621-9d77-7cf9b7121242  standard   status=1    --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
5bc984ee-e2d2-4312-9e6c-b2864524a21f  standard   status=0    --- files=200 freed=1.13GB catalogChecked=0 lowMatchKept=0 r2Missed=3 apply=0
708a8ce4-96dd-409d-94e7-a91d5032e4e0  standard   status=0    --- files=66 freed=0.41GB catalogChecked=0 lowMatchKept=0 r2Missed=1 apply=0
7fb55262-e658-45e2-88c0-b0e8ccc5ad6c  standard   status=0    --- files=12 freed=0.02GB catalogChecked=0 lowMatchKept=0 r2Missed=27 apply=0
a29ac9dc-cf0a-455b-964c-e75bd2f5fc47  standard   status=0    --- files=59 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=18 apply=0
bf810416-2f4c-4c4b-b27c-1270ea6f20b3  standard   status=1    --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
c2850c54-3396-420a-b7c3-92faae3137c1  standard   status=0    --- files=2 freed=0.04GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
d70ff7b3-e26b-4d23-8e05-bfc5d6f7a342  standard   status=1    --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
f6a39f3c-210b-479b-a8e7-c78491c120e9  standard   status=1    --- files=1 freed=0.01GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
5bc984ee-e2d2-4312-9e6c-b2864524a21f  canonical  status=0    --- pass1_ingested=0 pass2_canonical=0 pass3_raw=0 canonical_checked=1 canonical_low_match=1 total_files=0 freed=0.00GB apply=0 trash_dir=data/_trash/2026-06-19 ---
```

## Apply verification

- Apply footer from `5bc984ee-e2d2-4312-9e6c-b2864524a21f`:

```text
cap: MAX_FILES reached
--- files=200 freed=1.13GB catalogChecked=0 lowMatchKept=0 r2Missed=3 apply=1
```

- Fresh trash payload created at `data/_trash/2026-06-19/` in that workspace:

```text
1.2G  /paperclip/instances/default/workspaces/5bc984ee-e2d2-4312-9e6c-b2864524a21f/data/_trash/2026-06-19
200
```

- Post-apply rerun for the cleaned workspace dropped below the trigger:

```text
--- files=165 freed=0.75GB catalogChecked=0 lowMatchKept=0 r2Missed=21 apply=0
```

## Notes

- The sweep performed the required apply pass on the single workspace that crossed `1.00 GB`, but `/dev/vda1` still ended at `24G` free because live disk growth elsewhere outweighed the reclaim during this heartbeat.
- Free space remains above the runbook's incident threshold (`20 GB`), so no new `[INCIDENT] workspace disk reclaim needed` issue was opened.
- Several zero-candidate workspaces still returned `status=1`; the operational decision continued to rely on the printed candidate summary rather than exit code alone.
