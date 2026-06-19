# BUY-53236 worker node disk-space enforcement (WC cycle artifact cleanup)

Verified on 2026-06-19.

## Scope

- Executed `scripts/wc-cycle-cleanup.sh` directly in the Oracle workspace with the issue-specified retention and alert threshold.

## Command

```bash
WORKSPACE_DIR="$PWD" \
REPORT_PATH="$PWD/reports/BUY-53236-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.json" \
LOG_PATH="$PWD/reports/BUY-53236-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.log.jsonl" \
bash scripts/wc-cycle-cleanup.sh --apply --keep=48 --workspace-dir="$PWD" --alert-pct=90
```

## Result

- Exit code: `0`
- Workspace scanned: `/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api`
- WC cycle files older than 48 hours before the run: `0`
- Files moved to trash: `0`
- Trash files purged: `0`
- Reclaimed space: `0 KB`
- Root filesystem usage after run: `89%` in the cleanup report (`88%` on immediate follow-up `df -Pk "$PWD"` sample)
- Alert threshold: `90%`
- Alert required: `no`

## Artifacts

- JSON report: `reports/BUY-53236-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.json`
- JSONL action log: not created because the run found no stale files to move or purge
