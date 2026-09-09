# Fleet Agent Policy — BuyWhere

## GOOGLE CLOUD IS DECOMMISSIONED (2026-08-28 — founder directive, standing rule)

**BuyWhere runs on Railway only.** Google Cloud project `gaia-calendar-488606` (Cloud Run, Cloud SQL
`buywhere-staging`, Memorystore, Artifact Registry) is being shut down. There is NO GCP production and
there never will be again.

1. **Never deploy to, create, or repoint anything at Google Cloud.** The workflows
   `deploy-api-production.yml` (Cloud Run) and `build-on-push.yml` (Artifact Registry) and `deploy/gcp/`
   have been deleted. Do not recreate them, do not run `gcloud`, do not add `GCP_*` secrets.
   (Rex triggered the Cloud Run deploy workflow on 26 Aug and again on 28 Aug 07:06 — it fails, and it
   was never the production deploy.)
2. **Production deploys are Railway deploys**: `serviceInstanceDeployV2` on the BuyWhere Railway project
   (see the deploy-railway / deploy-mcp-railway workflows). "production" in a workflow name is not a
   deploy target — read the file.
3. **Embeddings resume ONLY under the founder-approved 60-day plan (BUY-76567, 28 Aug 2026).**
   The old Gemini pipeline is gone for good: the vector table was wiped on 11–12 Aug and re-embedded at
   7–15x the market rate while nothing consumed it. New rules: ALL embedding calls go through Flow AI —
   `POST https://api.flowaiapi.com/v1/embeddings`, model `flow-embed-1` (Qwen3-Embedding-4B, 1024-dim),
   with the dedicated Flow API key Richmond provisions (the budget fence — $10 one-off, $25/month, the key
   itself refuses over-budget calls); never call DeepInfra/SiliconFlow/Gemini directly for embeddings; scope = in-stock, priced
   products only; feature first (hybrid search default + product matching), backfill second; nightly
   pg_dump of product_embeddings to R2; only the embed worker may write to vector-db — never a one-shot
   service with DSNs attached. No Gemini embedding calls, ever. Read BUY-76567 before touching search.


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
