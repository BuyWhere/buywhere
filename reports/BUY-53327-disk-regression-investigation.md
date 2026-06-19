# BUY-53327 disk regression investigation

Timestamp: 2026-06-19T03:24Z to 2026-06-19T03:46Z

## Findings

- `/dev/vda1` regressed from roughly `34G` free on 2026-06-13 to about `22G` free by the 2026-06-19 dry-run sweep, then to about `20.4G` free during the later watchdog checks.
- The largest current shared-workspace consumers are not in this checkout alone:
  - `19dcd635-1d2b-4e41-9950-5865876e12b2/data`: `18G`
  - `5bc984ee-e2d2-4312-9e6c-b2864524a21f/data`: `6.4G`
  - `3ec8f6dd-1735-4479-9825-a2c42edac34c/data`: `2.6G`
  - `476c8023-3635-45bb-9f71-db6f4f5700e1/data`: `1.7G`
- The biggest concrete offenders inside those trees are:
  - `19dcd.../data/buy14124-validated-fullproducts.jsonl`: `8.8G`
  - `19dcd.../data/buy14124-chunks2`: `5.1G`
  - `19dcd.../data/buy14124-chunks`: `3.7G`
  - `5bc984.../data/_trash`: `2.8G`
  - `5bc984.../data/canonical`: `1.5G`
  - `5bc984.../data/google_shopping_products.jsonl`: `0.76G`

## Root Cause

- The existing workspace-safe cleanup routines mostly move eligible files into `data/_trash` on the same filesystem.
- That preserves reversibility, but it does not reclaim `/dev/vda1` immediately.
- Across the shared workspaces root, `_trash` alone held `5.11G` before this heartbeat.
- This explains why repeated "freed" totals in earlier cleanup sweeps did not reliably translate into sustained filesystem headroom.

## Change Made

- Updated `scripts/buy-53114-worker-node-artifact-cleanup.sh` to archive mature `data/_trash/<date>/` directories into `data/_trash_archives/<date>.tar.gz` and delete the uncompressed source tree afterward.
- New knobs:
  - `TRASH_ARCHIVE_MINUTES` default `360`
  - `TRASH_ARCHIVE_MIN_KB` default `262144`
  - `TRASH_ARCHIVE_DIRNAME` default `_trash_archives`
- The shared worker cleanup path now reclaims staged trash bytes while preserving a reversible compressed artifact.

## Verification

- Syntax check: `bash -n scripts/buy-53114-worker-node-artifact-cleanup.sh`
- Apply run:

```bash
WORKSPACES_ROOT=/paperclip/instances/default/workspaces \
APPLY=1 \
TRASH_ARCHIVE_MINUTES=360 \
TRASH_ARCHIVE_MIN_KB=1024 \
REPORT_PATH="$PWD/reports/BUY-53327-worker-node-artifact-cleanup-report.json" \
bash scripts/buy-53114-worker-node-artifact-cleanup.sh
```

- Archive results from the run log:
  - `3ec8f6dd.../data/_trash/2026-06-17`: `979772 KB` -> `93774 KB` archive, `885998 KB` reclaimed
  - `3ec8f6dd.../data/_trash/2026-06-18`: `1067092 KB` -> `102156 KB` archive, `964936 KB` reclaimed
  - `5bc984ee.../data/_trash/2026-06-18`: `1744664 KB` -> `199485 KB` archive, `1545179 KB` reclaimed
- Shared cleanup report:
  - `reclaimed_kb=3396113`
  - `failed_count=0`
  - `disk_free_kb=24236644`
- Filesystem delta measured around the apply run:
  - `before_kb=20869696`
  - `after_kb=24251204`
  - `delta_kb=3381508` (about `3.22 GiB`)
- Post-run archive footprint across workspaces: `404903102` bytes (`~0.38 GiB`)

## Remaining Gap

- The archive compaction raised free space from about `20.9G` to about `24.2G`, but it did not fully restore the `25G` safety margin.
- The remaining shortfall is now dominated by the `19dcd...` BUY-14124 data set, which needs workspace-specific retention/cleanup decisions rather than more generic worker-node hygiene.

## Final Resolution

- Follow-up issue [BUY-53331] archived the inert BUY-14124 data set in workspace `19dcd635-1d2b-4e41-9950-5865876e12b2`, which was the remaining dominant consumer after the generic cleanup fix.
- Current host state sampled on `2026-06-19`: `39,936,116 KB` free on `/dev/vda1` (`81%` used, about `38.1 GiB` free), which is safely above the `25G` margin.
- The durable automation change from this issue is the new `_trash` compaction path in `scripts/buy-53114-worker-node-artifact-cleanup.sh`; the workspace-specific archive from BUY-53331 handled the one-off retained data set that generic hygiene should not delete by default.
- No further threshold expansion was needed in `scripts/buy-53125-safe-data-cleanup.sh` for this regression because the missing reclaimed bytes were already in staged `_trash` and one known retained data set, not in a broader class of safe-delete candidates.
