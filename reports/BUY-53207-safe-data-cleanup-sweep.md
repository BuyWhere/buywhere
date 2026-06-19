# BUY-53207 safe-data-cleanup sweep

Timestamp: 2026-06-19T00:07:xxZ to 2026-06-19T00:10:47Z

## Summary

- Ran a fresh dry-run probe for every workspace root currently exposing `safe-data-cleanup.sh`.
- Ran a fresh dry-run probe for the single workspace root exposing `safe-canonical-cleanup.sh`.
- No workspace met the routine `>= 1.00 GB` estimated reclaim threshold, so no `--apply` cleanup run was performed in this heartbeat.
- No canonical cleanup apply run was warranted because no standard cleanup candidate crossed the threshold.
- `/dev/vda1` remains above the `25 GB` safety target at `29G` free (`86%` used).

## Disk state

```text
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1       193G  165G   29G  86% /

Filesystem     1K-blocks      Used Available Use% Mounted on
/dev/vda1      202051056 172529144  29505528  86% /
```

## Workspace dry-run results

```text
0ed653ab-62ba-4deb-8348-3086ab46961c  standard   status=1    --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
19dcd635-1d2b-4e41-9950-5865876e12b2  standard   status=1    --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=10 apply=0
2e68d8a0-9b0e-4573-8185-323edaabb186  standard   status=1    --- files=8 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
3ec8f6dd-1735-4479-9825-a2c42edac34c  standard   status=0    --- files=3 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=54 apply=0
4df23039-272b-4621-9d77-7cf9b7121242  standard   status=1    --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
5bc984ee-e2d2-4312-9e6c-b2864524a21f  standard   status=0    --- files=200 freed=0.76GB catalogChecked=0 lowMatchKept=0 r2Missed=3 apply=0
708a8ce4-96dd-409d-94e7-a91d5032e4e0  standard   status=0    --- files=65 freed=0.41GB catalogChecked=0 lowMatchKept=0 r2Missed=1 apply=0
7fb55262-e658-45e2-88c0-b0e8ccc5ad6c  standard   status=0    --- files=12 freed=0.02GB catalogChecked=0 lowMatchKept=0 r2Missed=27 apply=0
a29ac9dc-cf0a-455b-964c-e75bd2f5fc47  standard   status=0    --- files=59 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=18 apply=0
bf810416-2f4c-4c4b-b27c-1270ea6f20b3  standard   status=1    --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
c2850c54-3396-420a-b7c3-92faae3137c1  standard   status=0    --- files=2 freed=0.04GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
d70ff7b3-e26b-4d23-8e05-bfc5d6f7a342  standard   status=1    --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
f6a39f3c-210b-479b-a8e7-c78491c120e9  standard   status=1    --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
5bc984ee-e2d2-4312-9e6c-b2864524a21f  canonical  status=0    --- pass1_ingested=0 pass2_canonical=0 pass3_raw=0 canonical_checked=0 canonical_low_match=0 total_files=0 freed=0.00GB apply=0 trash_dir=data/_trash/2026-06-19 ---
```

## Notes

- The largest standard cleanup candidates remained `5bc984ee-e2d2-4312-9e6c-b2864524a21f` at `0.76 GB` and `708a8ce4-96dd-409d-94e7-a91d5032e4e0` at `0.41 GB`, both below the apply trigger.
- Workspace `5bc984ee-e2d2-4312-9e6c-b2864524a21f` needed a targeted rerun with a longer timeout to reach its final summary; the initial 20-second fleet pass timed out after printing candidate lines but before the aggregate footer.
- Several zero-candidate workspaces still return `status=1`; the operational decision continues to rely on the reported candidate summary, not the exit code alone.
- Because no apply sweep ran, there was no new `_trash` payload to tarball, no parent issue free-space comment was required by the runbook's tarball branch, and no incident follow-up was warranted.
