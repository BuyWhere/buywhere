# BUY-53732 disk reclaim report

Timestamp: 2026-06-19T18:04Z

## Context

- Issue start measurement from Paperclip context: `/dev/vda1` available `24,515,336` 1K blocks (`23.38 GiB` free).
- Current host state before targeted reclaim in this heartbeat: `26.14 GiB` free.

## Action taken

- Ran `scripts/buy-53114-worker-node-artifact-cleanup.sh` with `APPLY=1` across `/paperclip/instances/default/workspaces`.
  - Result: no additional stale watchdog/log artifacts were eligible for deletion in this pass.
- Removed one mature quarantine archive:
  - `/paperclip/instances/default/workspaces/19dcd635-1d2b-4e41-9950-5865876e12b2/data/_trash_archives/buy14124-validated-fullproducts.jsonl.zst`
  - Size reclaimed: `750,616,576` bytes (`0.70 GiB`)
  - Archive provenance: the sibling log `BUY-53331-archive-fast-20260619T035920Z.log` shows this file was already archived quarantine data, not a live workspace input.

## Measurements

- Before delete: `28,072,476,672` bytes free (`26.14 GiB`)
- After delete: `28,823,093,248` bytes free (`26.84 GiB`)
- Delta: `750,616,576` bytes (`0.70 GiB`)

## Final state

- `df -h /` after reclaim:

```text
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1       193G  166G   27G  87% /
```

- `/dev/vda1` remains above the `25 GiB` warning threshold with roughly `1.84 GiB` of headroom.
