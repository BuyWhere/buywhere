# BUY-53312 worker node disk-space enforcement (WC cycle artifact cleanup)

Verified on 2026-06-19.

## Scope

- Executed `scripts/wc-cycle-cleanup.sh` directly in the assigned workspace with the issue retention window and alert threshold.

## Command

```bash
REPORT_PATH="$PWD/reports/BUY-53312-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.json" \
LOG_PATH="$PWD/reports/BUY-53312-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.log.jsonl" \
bash scripts/wc-cycle-cleanup.sh --apply --keep=48 --workspace-dir="$PWD" --alert-pct=90
```

## Result

- Exit code: `0`
- Workspace scanned: `/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api`
- WC cycle files older than 48 hours before the run: `0`
- Files moved to trash: `0`
- Trash files purged: `0`
- Reclaimed space: `0 KB`
- Root filesystem usage after run: `89%`
- Alert threshold: `90%`
- Alert required: `no`

## Notes

- The cleanup only targets `data/**/cycle-*.ndjson` and `data/**/wc-deep-cycle-*.ndjson`; other older `.ndjson` files remain intentionally out of scope.
- No JSONL action log file was created because the cleanup script only emits it when it moves or purges artifacts.

## Artifacts

- JSON report: `reports/BUY-53312-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.json`
- Markdown report: `reports/BUY-53312-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.md`
