# BUY-53388 worker node disk-space enforcement (WC cycle artifact cleanup)

Verified on 2026-06-19.

## Scope

- Executed `scripts/wc-cycle-cleanup.sh` directly in the assigned workspace with the standard 48-hour retention window and `90%` disk alert threshold.

## Command

```bash
REPORT_PATH="$PWD/reports/BUY-53388-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.json" \
LOG_PATH="$PWD/reports/BUY-53388-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.log.jsonl" \
bash scripts/wc-cycle-cleanup.sh --apply --keep=48 --workspace-dir="$PWD" --alert-pct=90
```

## Result

- Exit code: `0`
- Workspace scanned: `/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api`
- WC cycle files older than 48 hours before the run: `0`
- Files moved to trash: `0`
- Trash files purged: `0`
- Reclaimed space: `0 KB`
- Root filesystem usage after run: `81%`
- Root filesystem free space after run: `38644272 KB`
- Alert threshold: `90%`
- Alert required: `no`

## Notes

- `data/buy31015_wc_deep` was approximately `32M` at sampling time and contained only recent cycle files from 2026-06-18 through 2026-06-19, so no retention action was expected.
- No JSONL action log was created because the run found no stale WC cycle artifacts to move or purge.
- A direct `df -Pk "$PWD"` sample immediately after the run also reported `81%` filesystem usage on `/dev/vda1`.

## Artifacts

- JSON report: `reports/BUY-53388-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.json`
- Markdown report: `reports/BUY-53388-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.md`
