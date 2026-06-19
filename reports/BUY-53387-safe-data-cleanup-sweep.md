# BUY-53387 safe-data-cleanup sweep

Timestamp: 2026-06-19T06:06:52Z
Date: 2026-06-19

## Summary

## Workspace 0ed653ab-62ba-4deb-8348-3086ab46961c

- Dry run: `timeout 150s ./safe-data-cleanup.sh --skip-r2 --skip-catalog-check --grace=0`
- Exit code: 1
- Dry-run summary: `--- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0`
- Apply: skipped because estimated reclaim is below 1 GB.

## Workspace 19dcd635-1d2b-4e41-9950-5865876e12b2

- Dry run: `timeout 150s ./safe-data-cleanup.sh --skip-r2 --skip-catalog-check --grace=0`
- Exit code: 1
- Dry-run summary: `--- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=9 apply=0`
- Apply: skipped because estimated reclaim is below 1 GB.

## Workspace 2e68d8a0-9b0e-4573-8185-323edaabb186

- Dry run: `timeout 150s ./safe-data-cleanup.sh --skip-r2 --skip-catalog-check --grace=0`
- Exit code: 1
- Dry-run summary: `--- files=9 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0`
- Apply: skipped because estimated reclaim is below 1 GB.

## Workspace 3ec8f6dd-1735-4479-9825-a2c42edac34c

- Dry run: `timeout 150s ./safe-data-cleanup.sh --skip-r2 --skip-catalog-check --grace=0`
- Exit code: 1
- Dry-run summary: `--- files=5 freed=0.19GB catalogChecked=0 lowMatchKept=0 r2Missed=42 apply=0`
- Apply: skipped because estimated reclaim is below 1 GB.

## Workspace 4df23039-272b-4621-9d77-7cf9b7121242

- Dry run: `timeout 150s ./safe-data-cleanup.sh --skip-r2 --skip-catalog-check --grace=0`
- Exit code: 1
- Dry-run summary: `--- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0`
- Apply: skipped because estimated reclaim is below 1 GB.

## Workspace 5bc984ee-e2d2-4312-9e6c-b2864524a21f

- Dry run: `timeout 150s ./safe-data-cleanup.sh --skip-r2 --skip-catalog-check --grace=0`
- Exit code: 124
- Dry-run summary: `no summary emitted`
- Result: timed out before a complete pass; not applied.

## Workspace 708a8ce4-96dd-409d-94e7-a91d5032e4e0

- Dry run: `timeout 150s ./safe-data-cleanup.sh --skip-r2 --skip-catalog-check --grace=0`
- Exit code: 0
- Dry-run summary: `--- files=65 freed=0.41GB catalogChecked=0 lowMatchKept=0 r2Missed=1 apply=0`
- Apply: skipped because estimated reclaim is below 1 GB.

## Workspace 7fb55262-e658-45e2-88c0-b0e8ccc5ad6c

- Dry run: `timeout 150s ./safe-data-cleanup.sh --skip-r2 --skip-catalog-check --grace=0`
- Exit code: 1
- Dry-run summary: `--- files=12 freed=0.02GB catalogChecked=0 lowMatchKept=0 r2Missed=27 apply=0`
- Apply: skipped because estimated reclaim is below 1 GB.

## Workspace a29ac9dc-cf0a-455b-964c-e75bd2f5fc47

- Dry run: `timeout 150s ./safe-data-cleanup.sh --skip-r2 --skip-catalog-check --grace=0`
- Exit code: 0
- Dry-run summary: `--- files=59 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=20 apply=0`
- Apply: skipped because estimated reclaim is below 1 GB.

## Workspace bf810416-2f4c-4c4b-b27c-1270ea6f20b3

- Dry run: `timeout 150s ./safe-data-cleanup.sh --skip-r2 --skip-catalog-check --grace=0`
- Exit code: 1
- Dry-run summary: `--- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0`
- Apply: skipped because estimated reclaim is below 1 GB.

## Workspace c2850c54-3396-420a-b7c3-92faae3137c1

- Dry run: `timeout 150s ./safe-data-cleanup.sh --skip-r2 --skip-catalog-check --grace=0`
- Exit code: 0
- Dry-run summary: `--- files=3 freed=0.04GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0`
- Apply: skipped because estimated reclaim is below 1 GB.

## Workspace d70ff7b3-e26b-4d23-8e05-bfc5d6f7a342

- Dry run: `timeout 150s ./safe-data-cleanup.sh --skip-r2 --skip-catalog-check --grace=0`
- Exit code: 1
- Dry-run summary: `--- files=0 freed=0.00GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0`
- Apply: skipped because estimated reclaim is below 1 GB.

## Workspace f6a39f3c-210b-479b-a8e7-c78491c120e9

- Dry run: `timeout 150s ./safe-data-cleanup.sh --skip-r2 --skip-catalog-check --grace=0`
- Exit code: 1
- Dry-run summary: `--- files=1 freed=0.03GB catalogChecked=0 lowMatchKept=0 r2Missed=0 apply=0`
- Apply: skipped because estimated reclaim is below 1 GB.

## Totals

- Sweep finished: 2026-06-19T06:13:53Z
- Workspaces with `safe-data-cleanup.sh`: 13
- Workspaces above 1 GB dry-run threshold: 0
- Workspaces applied: 0
- Workspaces with canonical apply: 0
- Trash trees compressed: 0
- Total reclaimed by apply runs: 0.00 GB
- Non-fatal script exits: 0
- Timeouts: 1

## Disk State

```text
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1       193G  156G   37G  81% /
```
