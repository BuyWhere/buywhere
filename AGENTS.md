# Fleet Agent Policy — BuyWhere

This document is for autonomous agents operating in the BuyWhere repository.

## API Key Hygiene (BUY-72823 — standing rule)

**Do NOT mint throwaway prod keys in test loops or probe harnesses.**

1. **ONE standing key per agent.** Each agent doing API testing uses exactly ONE
   named key, format `<agent>-qa` (e.g. `rex-qa`), created once and stored in
   fleet-secrets.json. Never mint new keys within a loop, a probe run, or a CI
   job.
2. **Flag is_internal=true at creation.** Internal keys are excluded from growth
   cohorts and signup metrics. The `is_internal` boolean on the key record is
   the gate — set it when minting the standing key.
3. **Prod key creation requires an issue reference.** Any `/v1/auth/register`
   call in production context must reference a board issue in its `use_case`
   or `agent_name` field.
4. **Existing standing keys:** `BUYWHERE_API_KEY` (free tier, in use),
   `BUYWHERE_MONITORING_API_KEY` (`bw_live_`, monitoring tier, is_internal).
   Do NOT add more.

**Q: What counts as "testing"?** Any curl/probe/automated smoke test that hits
live prod. **What does NOT count:** one-off exploratory curls by a human in a
terminal (those don't mint keys anyway).

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
