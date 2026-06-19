# BUY-53340 worker node disk-space enforcement (WC cycle artifact cleanup)

Verified on 2026-06-19.

## Scope

- Executed `scripts/wc-cycle-cleanup.sh` directly in the assigned workspace with the standard 48-hour retention window and `90%` disk alert threshold.

## Command

```bash
WORKSPACE_DIR="$PWD" \
REPORT_PATH="$PWD/reports/BUY-53340-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.json" \
LOG_PATH="$PWD/reports/BUY-53340-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.log.jsonl" \
bash scripts/wc-cycle-cleanup.sh --apply --keep=48 --workspace-dir="$PWD" --alert-pct=90
```

## Result

- Exit code: `0`
- Workspace scanned: `/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api`
- WC cycle files older than 48 hours before the run: `0`
- Files moved to trash: `0`
- Trash files purged: `0`
- Reclaimed space: `0 KB`
- Root filesystem usage after the cleanup report: `81%`
- Immediate follow-up `df -Pk "$PWD"` sample at `2026-06-19T04:19:02Z`: `80%` used, `41258400 KB` free
- Alert threshold: `90%`
- Alert required: `no`

## Retention Check

- Oldest live WC cycle artifact found before closeout: `data/buy31015_wc_deep/wc-deep-cycle-1-2026-06-18T21-02-51-693Z.ndjson`
- Newest live WC cycle artifact sampled after the run: `data/buy31015_wc_deep/wc-deep-cycle-255-2026-06-19T04-19-00-475Z.ndjson`
- Conclusion: all current WC cycle artifacts in this workspace are younger than the 48-hour retention window, so the apply run correctly performed no cleanup.

## Artifacts

- Markdown report: `reports/BUY-53340-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.md`
- JSON report: `reports/BUY-53340-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.json`
- JSONL action log: not created because the run found no stale files to move or purge
