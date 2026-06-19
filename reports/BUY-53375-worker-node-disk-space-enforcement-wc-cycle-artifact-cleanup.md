# BUY-53375 worker node disk-space enforcement (WC cycle artifact cleanup)

Verified on 2026-06-19.

## Scope

- Executed `scripts/wc-cycle-cleanup.sh` directly in the Oracle workspace with the issue-specified 48-hour retention window and `90%` disk alert threshold.

## Command

```bash
REPORT_PATH="$PWD/reports/BUY-53375-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.json" \
LOG_PATH="$PWD/reports/BUY-53375-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.log.jsonl" \
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
- Root filesystem free space after run: `39501756 KB`
- Alert threshold: `90%`
- Alert required: `no`

## Notes

- No JSONL action log was created because the run found no stale WC cycle artifacts to move or purge.
- Immediate follow-up sampling also showed `81%` filesystem usage via `df -Pk "$PWD"`.

## Artifacts

- JSON report: `reports/BUY-53375-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.json`
- Markdown report: `reports/BUY-53375-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.md`
