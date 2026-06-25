# BUY-57327: Worker node disk-space enforcement (WC cycle artifact cleanup)

## Final status: done

### What this issue delivered

1. **Deprecated 74 fragmented per-issue scripts** — every old `run-buy-*` and `setup-buy-*` WC cycle cleanup script now has a `DEPRECATED by BUY-57327` header pointing to the canonical `run-buy-57311-worker-wc-cycle-cleanup.sh`.

2. **Canonical cleanup running on cron** — single entry at `0 */6 * * *` with dedup marker `wc-cycle-cleanup-cron`, verified in `crontab -l`.

3. **Cleanup tested and working** — last run trashed 79 stale ndjson files across 3 worker workspaces. 0 stale files remain. Disk at 64% (well below 90% alert threshold).

4. **Only active scripts remaining:**
   - `scripts/run-buy-57311-worker-wc-cycle-cleanup.sh` (canonical runner)
   - `scripts/setup-buy-57311-worker-node-disk-space-enforcement.sh` (canonical setup)
   - `scripts/wc-cycle-cleanup.sh` (shared cleanup engine)
   - `scripts/run-buy-57232-disk-watchdog-cron.sh` (separate disk watchdog)

### Commit
- `0a217596` BUY-57327: enforce WC cycle artifact cleanup consolidation — deprecate 74 fragmented scripts

### Disk status
- Used: 64% (123G / 193G)
- Alert threshold: 90%
- No alert triggered

### Enforces
This completes the consolidation started in BUY-57311. The worker node WC cycle artifact cleanup is now fully enforced:
- Single cron entry covering all workspaces
- 48-hour retention window for cycle files
- 48-hour trash retention before permanent deletion
- 90% disk alert threshold
