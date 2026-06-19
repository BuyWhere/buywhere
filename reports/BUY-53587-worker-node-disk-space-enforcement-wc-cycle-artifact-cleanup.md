# BUY-53587 worker node disk-space enforcement (WC cycle artifact cleanup)

Verified on 2026-06-19.

## Change

- Extended `scripts/buy-53114-worker-node-artifact-cleanup.sh` so stale watchdog snapshot directories using the newer `buy-*-disk-watchdog-*` and `buy-*-disk-watchdog-smoke` names are pruned by the worker WC cleanup pass alongside the older `disk-monitor` names.
- Added regression coverage in `tests/worker-node-artifact-cleanup.test.mjs` to prove stale watchdog snapshots are removed while fresh snapshots remain.

## Why

- Recent cleanup evidence showed watchdog artifacts under `data/buy-*-disk-watchdog-*`, but the worker cleanup selector only matched `data/buy-*-disk-monitor-*`.
- That naming drift left stale watchdog snapshots outside the worker node disk-space enforcement path.

## Verification

- `bash -n scripts/buy-53114-worker-node-artifact-cleanup.sh`
- `node --test tests/worker-node-artifact-cleanup.test.mjs`

## Result

- Shell syntax check passed.
- Targeted worker cleanup test suite passed with `2/2` tests green:
  - stale WC cleanup logs are removed and fresh ones are retained
  - stale disk-watchdog snapshots are removed and fresh ones are retained
