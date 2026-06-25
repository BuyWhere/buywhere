# BUY-57351: Worker node disk-space enforcement (WC cycle artifact cleanup)

## Execution — 2026-06-25 11:20 UTC

### Status

**Disk: 64% used (70GB free)** — Healthy. All thresholds satisfied.

### What was done

This issue is a routine run of the WC cycle artifact cleanup. The cleanup infrastructure was already fully deployed and active from prior issues:

1. **`scripts/wc-cycle-cleanup.sh`** — Core cleanup engine (BUY-53095)
2. **`scripts/run-buy-57311-worker-wc-cycle-cleanup.sh`** — Consolidated cron runner (BUY-57311, runs every 6h)
3. **`scripts/worker-node-disk-enforcement.sh`** + **`scripts/run-buy-57336-worker-disk-enforcement.sh`** — Disk enforcement engine (BUY-57336, runs every 10 min)

All cron entries verified active in crontab.

### Cleanup run (this heartbeat)

Executed `run-buy-57311-worker-wc-cycle-cleanup.sh`:

| Metric | Value |
|--------|-------|
| Workspaces scanned | 3 |
| Stale files moved | 167 (zero-byte files) |
| Non-zero reclaimed | 1,631 KB (from wc-deep-cycle-11482) |
| Disk before | 64% (123G/193G) |
| Disk after | 64% (123G/193G) |
| Alert threshold | 90% |
| Alert fired | No |

8 additional zero-byte cycle files at exactly the 48h mtime boundary remain; will be collected on the next cron cycle.

### Cron coverage

| Cron | Schedule | Active |
|------|----------|--------|
| BUY-57311 WC cycle cleanup | Every 6h | ✅ |
| BUY-57336 Disk enforcement | Every 10 min | ✅ |
| BUY-57232 Disk watchdog | Every 5 min | ✅ |

### Verification

- Disk: `df -h /` → 193G, 123G used, 70G available (64%)
- Crontab: all 3 cleanup/enforcement entries present, markers verified
- Cleanup report: `BUY-57311-evidence/apply-report.json`
- Disk is well below the 85% enforce threshold and 90% alert threshold
