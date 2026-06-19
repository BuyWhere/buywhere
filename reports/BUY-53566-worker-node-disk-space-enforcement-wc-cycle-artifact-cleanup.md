# BUY-53566 worker node disk-space enforcement (WC cycle artifact cleanup)

Verified on 2026-06-19.

## Change

- Extended `scripts/buy-53114-worker-node-artifact-cleanup.sh` so stale direct WC cleanup runtime logs matching `*wc_cycle_cleanup*.log` are pruned by the normal log-retention pass.
- Added a standalone regression test in `tests/worker-node-artifact-cleanup.test.mjs` covering the missing selector.

## Why

- The worker cleanup already pruned stale supervisor, keepalive, worker, cron, and deep-cycle logs.
- It did not match issue-scoped WC cleanup logs such as `logs/buy53489_wc_cycle_cleanup.log`, so those artifacts could accumulate on the worker node outside the intended retention policy.

## Verification

- `bash -n scripts/buy-53114-worker-node-artifact-cleanup.sh`
- `node --test tests/worker-node-artifact-cleanup.test.mjs`

## Result

- The new test creates one stale and one fresh `*_wc_cycle_cleanup.log` file in a temporary workspace root.
- The cleanup script removes only the stale log with `APPLY=1` and leaves the fresh log in place.
- Test status: `pass`
