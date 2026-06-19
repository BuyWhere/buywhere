# BUY-53331 BUY-14124 retention audit

## Summary

- Audited workspace `19dcd635-1d2b-4e41-9950-5865876e12b2` after the generic worker cleanup from [BUY-53327].
- Confirmed the remaining disk pressure was dominated by three BUY-14124 artifacts written on 2026-06-16 through 2026-06-17:
  - `data/buy14124-validated-fullproducts.jsonl` at `8.8G`
  - `data/buy14124-chunks` at `3.7G`
  - `data/buy14124-chunks2` at `5.1G`
- Confirmed these were no longer live execution inputs:
  - `data/BUY-14124-final-status-2026-06-16T2045Z.md` describes them as probe and ingest artifacts.
  - `data/buy14124-ingest-seq.log` ends with `ALL DONE`.
  - `data/buy14124-ingest-seq2-resume2.log` ends with `ALL DONE`.

## Action

- Archived the large artifacts into a reversible compressed path under:
  - `/paperclip/instances/default/workspaces/19dcd635-1d2b-4e41-9950-5865876e12b2/data/_trash_archives/`
- Created:
  - `buy14124-validated-fullproducts.jsonl.zst` at `716M`
  - `buy14124-chunks.tar.zst` at `299M`
  - `buy14124-chunks2.tar.zst` at `410M`
- Removed the original live-disk copies only after each archive completed successfully.

## Result

- Original footprint: about `17.600 GiB`
- Archive footprint: about `1.425 GiB`
- Net reclaimed headroom: about `16.175 GiB`
- `/dev/vda1` before archive: `23G` free at `89%`
- `/dev/vda1` after archive: `39G` to `40G` free at `80%`
- Workspace `data/` footprint after archive: `1.5G`

## Evidence

- Archive run log:
  - `/paperclip/instances/default/workspaces/19dcd635-1d2b-4e41-9950-5865876e12b2/data/_trash_archives/BUY-53331-archive-fast-20260619T035920Z.log`
- Verification checks:
  - original `buy14124-validated-fullproducts.jsonl` removed
  - original `buy14124-chunks/` removed
  - original `buy14124-chunks2/` removed
