# BUY-53522 safe-data-cleanup sweep

Timestamp: 2026-06-19T10:47:00Z to 2026-06-19T11:01:00Z
Date: 2026-06-19

## Summary

- Enumerated every workspace root under `/paperclip/instances/default/workspaces` with `safe-data-cleanup.sh` and ran the required dry-run probe with `--skip-r2 --skip-catalog-check --grace=0`.
- Only `5bc984ee-e2d2-4312-9e6c-b2864524a21f` crossed the `>= 1.00 GB` apply gate, with a dry-run estimate of `1.53GB`.
- Applied `safe-data-cleanup.sh --apply` in that workspace and moved `200` files totaling `1.54GB` into `data/_trash/2026-06-19/`.
- Ran `safe-canonical-cleanup.sh` in the same workspace; both dry-run and apply found `0` additional canonical candidates.
- The total newly trashed payload stayed below the routine `> 4 GB` archive threshold, so no `tar.gz` compaction or `rm -rf` of the uncompressed trash tree was permitted this heartbeat.
- `/dev/vda1` ended the run at `27G` free (`28,421,771,264` bytes available), which remains above the `25 GB` safety margin and the `20 GB` incident threshold.

## Disk State

```text
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1       193G  167G   27G  87% /

Filesystem        1B-blocks         Used   Available Use% Mounted on
/dev/vda1      206900281344 178461732864 28421771264  87% /
```

## Workspace Dry-Run Results

```text
0ed653ab-62ba-4deb-8348-3086ab46961c  --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
19dcd635-1d2b-4e41-9950-5865876e12b2  --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=9 apply=0
2e68d8a0-9b0e-4573-8185-323edaabb186  --- files=12 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
3ec8f6dd-1735-4479-9825-a2c42edac34c  --- files=5 freed=0.19GB catalogChecked=0 lowMatchKept=0 r2Missed=42 apply=0
4df23039-272b-4621-9d77-7cf9b7121242  --- files=2 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
5bc984ee-e2d2-4312-9e6c-b2864524a21f  --- files=200 freed=1.53GB catalogChecked=0 lowMatchKept=0 r2Missed=3 apply=0
708a8ce4-96dd-409d-94e7-a91d5032e4e0  --- files=65 freed=0.41GB catalogChecked=0 lowMatchKept=0 r2Missed=1 apply=0
7fb55262-e658-45e2-88c0-b0e8ccc5ad6c  --- files=13 freed=0.02GB catalogChecked=0 lowMatchKept=0 r2Missed=27 apply=0
a29ac9dc-cf0a-455b-964c-e75bd2f5fc47  --- files=61 freed=0.94GB catalogChecked=0 lowMatchKept=0 r2Missed=20 apply=0
bf810416-2f4c-4c4b-b27c-1270ea6f20b3  --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
c2850c54-3396-420a-b7c3-92faae3137c1  --- files=6 freed=0.05GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
d70ff7b3-e26b-4d23-8e05-bfc5d6f7a342  --- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
f6a39f3c-210b-479b-a8e7-c78491c120e9  --- files=2 freed=0.03GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0
```

## Applied Workspace

Workspace: `5bc984ee-e2d2-4312-9e6c-b2864524a21f`

- `safe-data-cleanup.sh --apply --skip-r2 --skip-catalog-check --grace=0`
  - Result: `--- files=200 freed=1.54GB catalogChecked=0 lowMatchKept=0 r2Missed=3 apply=1`
- `safe-canonical-cleanup.sh --grace=0`
  - Result: `--- pass1_ingested=0 pass2_canonical=0 pass3_raw=0 canonical_checked=0 canonical_low_match=0 total_files=0 freed=0.00GB apply=0`
- `safe-canonical-cleanup.sh --apply --grace=0`
  - Result: `--- pass1_ingested=0 pass2_canonical=0 pass3_raw=0 canonical_checked=0 canonical_low_match=0 total_files=0 freed=0.00GB apply=1`

Representative files now under `data/_trash/2026-06-19/`:

- `canonical/google_shopping_canonical.ndjson`
- `target_us/results.jsonl`
- `shopify-discovery/wonderskin-com/products.jsonl`
- `shopify-discovery/liquiddeath-com/products.jsonl`
- `shopify-discovery/hobbiesville-com/products.jsonl`

## Notes

- This heartbeat intentionally stopped short of compressing the trash tree because the newly trashed payload was `1.54GB`, below the `> 4GB` threshold in the routine instructions.
- As a result, the sweep produced durable rollback state in `data/_trash/2026-06-19/` but did not translate that state into immediate free-space recovery on `/dev/vda1`.
- Parent issue [BUY-33215] should receive the current free-space reading after this sweep: `28,421,771,264` bytes available on `/dev/vda1`.
