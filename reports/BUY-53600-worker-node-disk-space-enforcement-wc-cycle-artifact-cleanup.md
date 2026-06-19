# BUY-53600 worker node disk-space enforcement (WC cycle artifact cleanup)

Verified on 2026-06-19.

## Change

- Extended `scripts/buy-53114-worker-node-artifact-cleanup.sh` so stale threshold verification artifacts named `BUY-*-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup-*.json` are pruned from workspace `reports/`.
- Added regression coverage in `tests/worker-node-artifact-cleanup.test.mjs` to prove stale threshold report artifacts are removed while fresh ones remain.

## Why

- The existing cleanup selector already covered the primary `.md`, `.json`, and `.log` report artifacts via `...artifact-cleanup.*`, but it missed threshold verification files like `...artifact-cleanup-threshold.json`.
- Those threshold artifacts are produced during alert-path verification and would accumulate outside the worker node disk-space enforcement retention path.

## Verification

- `bash -n scripts/buy-53114-worker-node-artifact-cleanup.sh`
- `node --test tests/worker-node-artifact-cleanup.test.mjs`

## Result

- Shell syntax check passed.
- Targeted worker cleanup test suite passed with `3/3` tests green:
  - stale WC cleanup logs are removed and fresh ones are retained
  - stale disk-watchdog snapshots are removed and fresh ones are retained
  - stale threshold cleanup reports are removed and fresh ones are retained
