# BUY-58069 — Worker node disk-space enforcement (WC cycle artifact cleanup)

## What was done

BUY-58069 worker node disk-space enforcement cron is now installed and operational on this worker node.

## Cron entry installed

- **Schedule:** `*/10 * * * *` (every 10 minutes)
- **Marker:** `disk-enforcement-buy-58069-cron`
- **Enforces at:** 85% disk usage
- **Critical threshold:** 95% disk usage (creates Paperclip incident)
- **WC artifact retention:** 48 hours

## Files created

| File | Purpose |
|------|---------|
| `scripts/run-buy-58069-worker-disk-enforcement.sh` | Cron wrapper — runs enforcement engine with --apply |
| `scripts/setup-buy-58069-worker-node-disk-space-enforcement.sh` | Idempotent cron installer |
| `BUY-58069-evidence/` | Evidence directory for enforcement reports |

## Enforcement engine

Leverages the existing `worker-node-disk-enforcement.sh` engine (BUY-57336):
- Scans all workspaces under `$WORKSPACES_ROOT`
- Triggers `wc-cycle-cleanup.sh --apply` when workspace exceeds 85% disk usage
- Creates Paperclip incident if still above 95% after cleanup
- Dedup logic: incident only if 30+ minutes since last

## Verification run

```
bash scripts/run-buy-58069-worker-disk-enforcement.sh
# BUY-58069: worker node disk-space enforcement starting
# BUY-57336 enforcement complete. dry_run=0 enforce_pct=85 critical_pct=95
# BUY-58069: enforcement completed. status=ok disk=69% free=60GB
```

**Current disk:** 69% used / 60GB free — no enforcement action needed.

## Evidence report

```json
{
  "ts": "2026-06-26T22:33:05Z",
  "issue": "BUY-58069",
  "enforce_pct": 85,
  "critical_pct": 95,
  "keep_hours": 48,
  "disk_root_pct": 69,
  "disk_root_free_gb": 60,
  "status": "ok",
  "enforcer_exit": 0
}
```

## Relates to

- BUY-57336: worker-node-disk-enforcement.sh (shared enforcement engine)
- BUY-53114: WC cycle artifact cleanup script (`wc-cycle-cleanup.sh`)
- BUY-48801: Disk space monitoring (diskSpaceRunner.ts)
