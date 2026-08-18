# Fleet Agent Policy — BuyWhere

This document is for autonomous agents operating in the BuyWhere repository.

## Production Deploy Policy

Production deploys MUST come from `main` only.

- Never dispatch `workflow_dispatch` production deploy workflows from a feature
  branch. The following workflows are production deploys and are guarded to
  fail when `github.ref != 'refs/heads/main'`:
  - `deploy-site-production.yml`
  - `deploy-api-production.yml`
  - `deploy-railway.yml`
  - `deploy-nginx-production.yml`
  - `deploy-www.yml`
  - `deploy-mcp-railway.yml`

- Why: a feature branch can be many commits behind `main`. Dispatching a
  production deploy from such a branch ships a stale build and can silently
  revert content that was merged to `main` but is not in the branch. On
  2026-07-29 this 410'd the entire BUY-64967 blog catch-up batch within hours
  of it going live.

- Correct process: finish the feature, open a PR, get it merged to `main`, and
  let the push to `main` auto-deploy. If a workflow must be retried, re-run the
  `main` run, not a branch run.

- If an emergency hotfix must reach production immediately, merge the hotfix
  branch to `main` first and deploy from `main`. Do not use a branch as a
  shortcut.
