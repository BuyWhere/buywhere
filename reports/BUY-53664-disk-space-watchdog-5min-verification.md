# BUY-53664 Disk Space Watchdog (5min) Verification

- Date: `2026-06-19`
- Routine: `BUY-48198`
- Scope: verify the dedicated 5-minute disk-space watchdog wrapper, cron installer, and coverage in this workspace

## Verified

- `api/src/jobs/diskSpaceWatchdog.ts` provides BUY-48198-specific environment defaults and entrypoint resolution for the watchdog wrapper.
- `scripts/run-buy-48198-disk-watchdog.sh` wraps the shared disk watchdog script with BUY-48198 state, label, and snapshot defaults.
- `scripts/run-buy-48198-disk-watchdog-cron.sh` runs the wc cleanup stage, worker artifact cleanup stage, then the watchdog, and explicitly tolerates cleanup return code `10`.
- `scripts/setup-buy-48198-disk-watchdog.sh` installs the canonical `*/5 * * * *` cron entry and triggers an immediate smoke pass.
- `api/tests/disk-watchdog.test.mjs` covers environment defaults, wrapper selection, snapshot directory creation, incident title helpers, and cron wrapper ordering.

## Command Results

- Passed: `node --test tests/disk-watchdog.test.mjs`
- Failed but unrelated to this watchdog change: `npm run build`

## Build Blocker

`npm run build` currently fails in existing API TypeScript sources because declaration packages for `express`, `cors`, `compression`, and `uuid` are not present in the workspace, producing broad `TS7016` and implicit `any` errors outside the watchdog files.
