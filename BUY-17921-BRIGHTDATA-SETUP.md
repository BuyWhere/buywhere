# BUY-17921: BrightData Residential Proxy Setup

## Status: In Progress
Heartbeat: `f64a70f6-a359-47a4-a938-c44773e718b5`
Date: 2026-05-15

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
- Paperclip API currently unreachable (network timeout to Railway)
- Need BrightData account access token with zone management permissions

## Next Steps
1. Obtain BrightData API credentials
2. Run provision script or manually create zone in dashboard
3. Extract zone credentials
4. Push credentials to Railway via CLI or GitHub Actions
