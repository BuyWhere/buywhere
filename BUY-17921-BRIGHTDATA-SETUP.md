# BUY-17921: BrightData Residential Proxy Setup

## Status: BLOCKED
Heartbeat: `f64a70f6-a359-47a4-a938-c44773e718b5` (recovery run)
Date: 2026-05-15
Recovery Owner: Rex (CTO)

## Objective
Provision working residential proxy credentials from BrightData and configure them in Shelf service on Railway.

## Current State

### Code Analysis
- **Proxy config module**: `scrapers/proxy_config.py` — Defines zone configuration and helpers
- **Zone provisioning**: `scrapers/provision_brightdata_zones.py` — Script to create/manage zones via BrightData API
- **Railway service**: `945e8a6d-6f89-41f1-8256-b8cc6a872a33` (buywhere-api)
- **Environment**: `ebcb2ca2-f5e8-4713-a3e1-48c92e2b23ae` on Railway

### Required Railway Environment Variables (RESIDENTIAL_PROXY1)
```
BRIGHTDATA_RESIDENTIAL_USERNAME = brd-customer-hl_3ab737be-zone-residential_proxy1
BRIGHTDATA_RESIDENTIAL_PASSWORD = <needs to be set>
BRIGHTDATA_RESIDENTIAL_HOST = brd.superproxy.io
BRIGHTDATA_RESIDENTIAL_PORT = 22225
```

## Action Items

1. **Access BrightData account** — Get credentials for the account authorized by board approval
2. **Create/verify residential zone** — Ensure `residential_proxy1` zone exists in BrightData
3. **Extract proxy credentials** — Get the password for the residential zone
4. **Configure Railway secrets** — Set the 4 env vars above in the Shelf service environment
5. **Verify connectivity** — Test that the proxy can be used from Railway

## Blockers
**Missing BrightData Account Access** (PRIMARY BLOCKER)
- No credentials for the approved BrightData account
- Cannot create or access proxy zones without account access
- Cannot retrieve zone credentials (username/password) for Railway
- Requires someone with BrightData dashboard access or account ownership

**Secondary Requirements**
- Railway API token or CLI access for setting environment variables on service `945e8a6d-6f89-41f1-8256-b8cc6a872a33`

## Next Steps (Ordered by Priority)

1. **[REQUIRED] Get BrightData account credentials**
   - Obtain API token with zone management permissions from the approved account
   - Or get credentials from existing residential_proxy1 zone if already created
   - Contact: Whoever has access to the approved BrightData account/subscription

2. **[OPTIONAL] Create residential_proxy1 zone**
   - If zone doesn't exist, run: `BRIGHTDATA_API_TOKEN="..." python -m scrapers.provision_brightdata_zones --zone residential_proxy1 --type residential`
   - If zone exists, retrieve username and password from dashboard

3. **[REQUIRED] Set Railway environment variables**
   - Use Railway CLI or GitHub Actions with RAILWAY_TOKEN
   - Target service: `945e8a6d-6f89-41f1-8256-b8cc6a872a33`
   - Target environment: `ebcb2ca2-f5e8-4713-a3e1-48c92e2b23ae`
   - Set the 4 env vars from credentials obtained in step 1

4. **[VERIFICATION] Test proxy connectivity**
   - Deploy updated code to Railway
   - Run a test scrape through the proxy to verify auth works

## Related Issues
- **Parent:** [BUY-16739](/BUY/issues/BUY-16739) - Waiting on this configuration
- **Dependent:** [BUY-16734](/BUY/issues/BUY-16734) - Blocked by BUY-16739
- **Board Approval:** [05fa44b8](/BUY/approvals/05fa44b8-e846-4444-9e85-647c240fa104) - Decision date 2026-05-15
