# BUY-53328 / BUY-48198 Disk Space Watchdog (5min) Alignment

Timestamp: 2026-06-19T03:49Z

## Change

- Updated the in-process API watchdog scheduler to prefer `scripts/run-buy-48198-disk-watchdog.sh` instead of the legacy `run-buy-52997-disk-watchdog-cron.sh` cleanup pipeline wrapper.
- Updated the default state-file path from `/tmp/buy-38913-disk-state.json` to `/tmp/buy-48198-disk-state.json` in both the scheduler and the watchdog wrapper script.
- Kept the legacy `buy-38913-disk-space-watchdog.cjs` script as a fallback entrypoint only.

## Why

- `BUY-53328` is scoped to the 5-minute disk watchdog itself: monitor `/dev/vda1`, warn below `20 GB`, and create a critical Paperclip incident below `5 GB`.
- The API scheduler was still wired to a broader legacy cleanup pipeline wrapper, which mixed watchdog execution with unrelated workspace cleanup behavior and old issue/state naming.
- This change aligns the runtime defaults with the issue description and current `BUY-48198` ownership without removing the existing cron pipeline.

## Verification

- Syntax checks:
  - `bash -n scripts/run-buy-48198-disk-watchdog.sh`
  - `bash -n scripts/run-buy-52997-disk-watchdog-cron.sh`
  - `bash -n scripts/setup-buy-48198-disk-watchdog.sh`
- Direct watchdog smoke run:

```bash
DISK_STATE_FILE="$PWD/data/buy-53328-disk-state.json" \
DISK_SNAPSHOT_DIR="$PWD/data/buy-53328-disk-monitor-20260619T034942Z" \
DISK_EXECUTION_ISSUE=BUY-53328 \
bash scripts/run-buy-48198-disk-watchdog.sh BUY-53328
```

- Smoke result:
  - `status=PASS`
  - `free_bytes=24837660672` (`23.1 GB`)
  - `snapshot_dir=data/buy-53328-disk-monitor-20260619T034942Z`

## Notes

- `npm run build` in `api/` still fails due to pre-existing TypeScript dependency/type-resolution errors unrelated to this watchdog change (`express`, `cors`, `ioredis`, `posthog-node`, `stripe`, `uuid`, and existing implicit-`any` errors). The checked-in `api/dist/jobs/diskSpaceWatchdog.js` was updated to keep runtime behavior aligned with source despite that unrelated build failure.
