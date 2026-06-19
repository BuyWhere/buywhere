# BUY-53593 worker node disk-space enforcement (WC cycle artifact cleanup)

Verified on 2026-06-19.

## Summary

- Restored the canonical `scripts/run-buy-48198-disk-watchdog-cron.sh` pipeline so the 5-minute watchdog once again runs:
  - `scripts/wc-cycle-cleanup.sh --apply --keep=48`
  - `scripts/buy-53114-worker-node-artifact-cleanup.sh`
  - `scripts/run-buy-48198-disk-watchdog.sh`
- Preserved the existing disk-threshold contract by treating cleanup exit code `10` as a non-fatal alert condition and continuing into the watchdog stage.
- Added a regression test proving the cron wrapper executes both cleanup stages before the watchdog and does not stop on the worker cleanup threshold alert.

## Verification

- `bash -n scripts/run-buy-48198-disk-watchdog-cron.sh`
- `node --test api/tests/disk-watchdog.test.mjs`

## Changed Files

- `scripts/run-buy-48198-disk-watchdog-cron.sh`
- `api/tests/disk-watchdog.test.mjs`
