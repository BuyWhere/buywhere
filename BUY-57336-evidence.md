# BUY-57336: Worker node disk-space enforcement (WC cycle artifact cleanup)

## Implementation — 2026-06-25

### What was built

1. **`scripts/worker-node-disk-enforcement.sh`** — Core enforcement engine
   - Scans all workspace directories under `WORKSPACES_ROOT` for disk usage
   - Skips workspaces below `ENFORCE_PCT` (default: 85%)
   - Triggers `wc-cycle-cleanup.sh --apply --keep=48` on workspaces exceeding threshold
   - Creates Paperclip critical incidents for workspaces still above `CRITICAL_PCT` (default: 95%) after cleanup
   - 30-minute incident dedup via state files in `/tmp/buy-57336-disk-enforcement/`
   - Incident state auto-clears when disk recovers below enforce threshold
   - Supports `--dry-run` mode (default for direct invocation), `--workspace-dir` for single-workspace targeting
   - Sources Paperclip credentials from `/home/paperclip/.paperclip_env`

2. **`scripts/run-buy-57336-worker-disk-enforcement.sh`** — Cron wrapper
   - Invokes enforcement engine with `--apply` every 10 minutes
   - Writes evidence report to `BUY-57336-evidence/enforcement-latest.json`
   - Logs to `logs/buy-57336-disk-enforcement.log`
   - Captures root disk summary for trend analysis

3. **`scripts/setup-buy-57336-worker-disk-enforcement.sh`** — Idempotent cron setup
   - Installs `*/10 * * * *` cron entry with `disk-enforcement-cron` marker
   - Deduplicates via marker — removes any stale `disk-enforcement-cron` entries
   - Validates runner exists before install

### Crontab status

- Installed: `*/10 * * * *` — `disk-enforcement-cron` marker verified (exactly 1 entry)
- Does NOT interfere with existing cron entries:
  - `wc-cycle-cleanup-cron` (BUY-57311, every 6h) — still active
  - `disk-watchdog-cron` (BUY-57232, every 5 min) — still active
  - All other existing entries untouched

### Initial enforcement pass

- Root disk: 64% (71GB free) — well below 85% enforce threshold
- All 70+ workspace directories scanned; none exceeded threshold
- No incidents created (expected — disk is healthy)
- No stale ndjson cleanup triggered (handled by BUY-57311 every 6h)

### Verification

- `crontab -l | grep disk-enforcement-cron` → exactly 1 entry
- `bash -n scripts/worker-node-disk-enforcement.sh` → syntax OK
- `bash -n scripts/run-buy-57336-worker-disk-enforcement.sh` → syntax OK
- `bash -n scripts/setup-buy-57336-worker-disk-enforcement.sh` → syntax OK
- Initial dry run + apply run completed (exit 0)

### Scripts created

| Script | Purpose |
|--------|---------|
| `scripts/worker-node-disk-enforcement.sh` | Core enforcement engine |
| `scripts/run-buy-57336-worker-disk-enforcement.sh` | Cron wrapper (--apply) |
| `scripts/setup-buy-57336-worker-disk-enforcement.sh` | Idempotent cron installer |
