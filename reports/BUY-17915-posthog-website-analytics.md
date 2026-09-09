# BUY-17915: BuyWhere website analytics from PostHog

Date: 2026-05-15
Agent: Lyra (`bbfe3377-eb84-412f-9119-493d1732b4fd`)

## Summary

I could not pull BuyWhere website analytics from PostHog in this heartbeat because the current codebase and live website do not expose a working website-to-PostHog analytics path, and no PostHog credentials were available in the workspace to query the PostHog API directly.

## Evidence

1. The live website currently loads Plausible and GA/Google Tag Manager scripts, not a browser PostHog SDK.
   - Repo evidence: [src/app/layout.tsx](/home/paperclip/buywhere-api/src/app/layout.tsx:74)
   - Live check on 2026-05-15 UTC: `https://buywhere.ai` returned script references for `plausible.io` and `googletagmanager.com`, with no `posthog` browser script found.

2. The repo's PostHog integration is server-side API instrumentation, not website page analytics.
   - Repo evidence: [api/src/analytics/posthog.ts](/home/paperclip/buywhere-api/api/src/analytics/posthog.ts:1)
   - Captured events in code:
     - `api_query`
     - `affiliate_click`
     - `agent_registered`
     - `compare_page_view`
     - `compare_retailer_click`
     - `email_verified`
     - `product_search`
     - `product_view`

3. The client-side analytics component initializes GA4 only.
   - Repo evidence: [src/components/AnalyticsTracker.tsx](/home/paperclip/buywhere-api/src/components/AnalyticsTracker.tsx:1)

4. No usable PostHog credential was present in the shell environment for this run.
   - Checked environment variables matching `POSTHOG|POST_HOG|BUYWHERE|ANALYTICS`.
   - `POSTHOG_API_KEY` was not available locally.

5. Deployment manifests reference a secret-backed `POSTHOG_API_KEY`, but the secret value is not available in this workspace.
   - Repo evidence: [deploy/gcp/api-service.yaml](/home/paperclip/buywhere-api/deploy/gcp/api-service.yaml:51)
   - Repo evidence: [.github/workflows/deploy-cloud-run-production.yml](/home/paperclip/buywhere-api/.github/workflows/deploy-cloud-run-production.yml:124)

## What I was able to verify

- `https://buywhere.ai` was reachable on 2026-05-15 UTC and returned HTTP 200.
- `https://api.buywhere.ai/v1/analytics/query-count` returned HTTP 503 with `{"error":"Admin API not configured"}`, so the public API does not provide a fallback path to website analytics metrics.

## Blocker

To produce an actual PostHog metrics report, one of these must be provided:

1. PostHog project access with a credential that can query insights/events, or
2. Confirmation that the desired source is Plausible/GA4 instead of PostHog, or
3. A deployed admin/reporting endpoint that exposes the required metrics.

## Recommended next step

Clarify the source of truth for "website analytics":

- If the request truly means PostHog, provide project/API access and identify the project/workspace to query.
- If the request means website traffic analytics, this likely needs to be pulled from Plausible or GA4 instead, because that is what the live website is instrumented with today.
