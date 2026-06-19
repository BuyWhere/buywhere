# BUY-53560 Disk Space Watchdog (5min) Verification

- Verified on: `2026-06-19`
- Issue: `BUY-53560`
- Routine/source issue: `BUY-48198`

## What was validated

- `api/src/jobs/diskSpaceWatchdog.ts` schedules the watchdog every 5 minutes by default and wires the BUY-48198 wrappers into API startup.
- `scripts/run-buy-48198-disk-watchdog.sh` and `scripts/run-buy-48198-disk-watchdog-cron.sh` provide the routine-specific entrypoints for direct execution and cron.
- `scripts/buy-38913-disk-space-watchdog.cjs` persists state, writes snapshots, and deduplicates critical incidents by filesystem-specific title.

## Test evidence

Ran:

```bash
cd api
npm test -- --test-force-exit tests/disk-watchdog.test.mjs
```

Result:

- `60` tests passed
- `0` failed
- The disk watchdog coverage specifically passed checks for:
  - BUY-48198 default state path
  - canonical BUY-48198 cron wrapper resolution
  - creation of missing parent directories for state and snapshot outputs
  - incident title generation and matching for the configured filesystem label
