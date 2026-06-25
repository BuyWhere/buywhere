# BUY-57327: Worker node disk-space enforcement (WC cycle artifact cleanup)

## Enforcement pass — 2026-06-25

### What was done

1. **DEPRECATED all 74 fragmented per-issue scripts** pointing to the canonical consolidated runner (`run-buy-57311-worker-wc-cycle-cleanup.sh`):
   - 67 tracked `run-buy-*-worker-wc-cycle-cleanup.sh` scripts (various issue numbers)
   - 7 additional scripts with no shebang line (starting with `# run-buy-*-worker-wc-cycle-cleanup.sh` comment)
   - 3 tracked `setup-buy-*-worker-node-disk-space-enforcement.sh` scripts
   - 2 untracked scripts (`run-buy-57207-worker-wc-cycle-cleanup.sh`, `run-buy-57188-disk-space-watchdog.sh`)
   - 1 untracked setup script (`setup-buy-57262-worker-node-disk-space-enforcement.sh`)
   - 1 untracked watchog setup script (`setup-buy-57188-disk-space-watchdog.sh`)

2. **Verified crontab** has exactly 1 WC cycle cleanup entry (the canonical `run-buy-57311` at `0 */6 * * *` with `wc-cycle-cleanup-cron` marker). No stale fragmented entries.

3. **Ran canonical cleanup** — 79 stale ndjson files trashed across 3 worker workspaces. Disk at 64% (well below 90% alert threshold).

### Scripts left active (non-deprecated)

- `scripts/run-buy-57311-worker-wc-cycle-cleanup.sh` (canonical consolidated runner)
- `scripts/setup-buy-57311-worker-node-disk-space-enforcement.sh` (canonical setup)
- `scripts/wc-cycle-cleanup.sh` (shared cleanup engine)
- `scripts/run-buy-57232-disk-watchdog-cron.sh` (separate disk-space watchdog, BUY-57232)
