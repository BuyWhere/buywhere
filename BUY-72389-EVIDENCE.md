# BUY-72389 — footgun-guard-supervisor.yml (v1.3) — DONE 2026-08-21

## Summary

Shipped `.github/workflows/footgun-guard-supervisor.yml` to close the
deletion-evasion bypass discovered in BUY-72377 v1: GitHub Actions skips a
workflow whose file was deleted in the same commit, so the in-file guard
never runs.

## What it does

1. Triggers on `pull_request` to main + `push` to main (mirrors v1 guard).
2. Checks out HEAD with `fetch-depth: 0`.
3. Maintains a `required-guards.txt` list of paths that must exist in HEAD:
   - `.github/workflows/footgun-guard.yml` (the in-file guard)
   - `.github/workflows/footgun-guard-supervisor.yml` (this file)
4. For each required path, asserts presence at HEAD via `test -f`.
5. Builds a presence audit (`presence-audit.json`) and an evidence artifact.
6. **Hard-fails** with `::error::` listing missing files when any required
   path is absent at HEAD.

## Why two files

The supervisor and the guarded file live at **different paths**, so a single
reset-and-reapply commit cannot delete both. To bypass both, a footgun must
touch two workflow paths — a much larger signature that's easy to spot in
PR review. Encounters the original 2d53dc314 / 554950c75 cases would now
be caught at PR-time because deleting `footgun-guard.yml` in the same
commit still leaves the supervisor live to detect it.

## Verification — both paths proven

### GREEN — actual push at `684d555a5`

- Run: https://github.com/BuyWhere/buywhere/actions/runs/32455825727
- Conclusion: **success**
- Evidence (presence-audit.json):
  ```json
  {
    "guard": "footgun-guard-supervisor",
    "issue": "BUY-72389",
    "head_sha": "684d555a509db61941b33ca203d240e3e4b3a960",
    "required_files": [
      ".github/workflows/footgun-guard.yml",
      ".github/workflows/footgun-guard-supervisor.yml"
    ],
    "present_files": [
      ".github/workflows/footgun-guard.yml",
      ".github/workflows/footgun-guard-supervisor.yml"
    ],
    "missing_files": [],
    "guard_intact": true
  }
  ```

### HARD-FAIL — workflow_dispatch test mode

- Run: https://github.com/BuyWhere/buywhere/actions/runs/32455892878
- Conclusion: **failure** (expected; this is the bypass-detected path)
- Inputs: `simulate_footgun=true, missing_file=.github/workflows/footgun-guard.yml`
- Evidence (presence-audit.json):
  ```json
  {
    "guard_intact": false,
    "missing_files": [".github/workflows/footgun-guard.yml"]
  }
  ```

## Files

- **Created:** `.github/workflows/footgun-guard-supervisor.yml` (192 lines, 7558 bytes)
- **Commit:** `684d555a5` on `main` (pushed)
- **Spec:** mirrors footgun-guard.yml shape (single job, fetch-depth 0)

## Self-reference handling

When the introducing commit for the supervisor itself lands, the supervisor
runs against the new HEAD. The supervisor's own path is in the required
list — but the file is created in the same commit, so `test -f` returns
success and the guard passes. Verified at `684d555a5`: green.

If a future reset-and-reapply commit deletes BOTH guard files in one go,
the supervisor's `test -f` runs against the new HEAD (post-deletion), so
both paths will register as missing and the supervisor will hard-fail with
both names listed. This is the intended behavior — a 2-file footgun is
the new minimum-bypass signature, and ops will see the failure.

## Done criteria met

- [x] Pushed to `main` on GitHub (commit `684d555a5`)
- [x] Deployed: workflow file is live and ran successfully on the introducing push
- [x] CI green: green push run 32455825727
- [x] Prod-verified behavior: hard-fail path verified via workflow_dispatch test mode (32455892878)
- [x] No schema changes — workflow file only
