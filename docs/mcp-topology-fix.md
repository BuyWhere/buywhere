# MCP Topology Normalization — BUY-18347 Fix

**Status**: Investigation Complete  
**Root Cause**: DNS/routing misconfiguration  
**Date**: 2026-05-16

## Executive Summary

The MCP public topology is broken: `mcp.buywhere.ai` routes to the main API service instead of the dedicated MCP Cloud Run service. This causes:

- `mcp.buywhere.ai/healthz` → 404 (should be 200, Knative probe)
- `mcp.buywhere.ai/health` → returns main API response (should include `"server":"mcp"`)

**Root cause**: DNS or Cloud Run routing directs `mcp.buywhere.ai` to `buywhere-api` instead of `buywhere-mcp`.

## What's Deployed

Two Cloud Run services are configured in GCP:

| Service | Port | Health Endpoint | Purpose |
|---------|------|-----------------|---------|
| `buywhere-api` | 3000 | `GET /health` | Main REST API + MCP endpoint |
| `buywhere-mcp` | 8081 | `GET /healthz` + `GET /health` | Dedicated MCP server |

### Current State (2026-05-16 02:35 UTC)

Verified endpoints:

```
api.buywhere.ai/health           → 200 ✓ (main API)
api.buywhere.ai/mcp              → 200 ✓ (requires API key)
mcp.buywhere.ai/health           → 200 ✗ (wrong: returns main API response)
mcp.buywhere.ai/healthz          → 404 ✗ (wrong: should return 200)
mcp.buywhere.ai/mcp              → 200 ✗ (wrong: should require auth)
```

## Root Cause Analysis

### Evidence

1. **Same Response Body**: Both `api.buywhere.ai/health` and `mcp.buywhere.ai/health` return:
   ```json
   {"status":"ok","ts":"2026-05-16T02:35:50.998Z"}
   ```

2. **MCP Server Code** (`api/src/mcp-server.ts:17-33`) exposes `/healthz` and returns:
   ```json
   {"status":"ok","server":"mcp","ts":"...","catalog":{"total_products":...}}
   ```

3. **Knative Configuration** (`deploy/gcp/mcp-service.yaml:53,59`) probes `/healthz`.

4. **Missing Endpoint**: Since `mcp.buywhere.ai/healthz` returns 404 (not Knative probe), the request never reaches the MCP container.

### Diagnosis

**`mcp.buywhere.ai` is currently routed to the `buywhere-api` service, not `buywhere-mcp`.**

This happens because:
- DNS CNAME or Cloud Run domain mapping is misconfigured
- The `buywhere-mcp` service may not be deployed, or
- DNS points to the wrong Cloud Run service URL

## Remediation Steps

### Phase 1: Verify MCP Service Deployment

**Action**: Check if `buywhere-mcp` Cloud Run service exists and is accessible.

```bash
# List all Cloud Run services
gcloud run services list --project=gaia-calendar-488606 --region=asia-southeast1

# Get MCP service URL
gcloud run services describe buywhere-mcp \
  --project=gaia-calendar-488606 \
  --region=asia-southeast1 \
  --format="value(status.url)"
```

**Expected**: Returns a URL like `https://buywhere-mcp-XXXX-XX.a.run.app`

**If missing**: Deploy using the workflow:
1. Push to `main` branch
2. Trigger `deploy-mcp-cloud-run-production.yml` workflow manually
3. Wait for deployment to complete
4. Verify service appears in `gcloud run services list`

### Phase 2: Update DNS/Routing

**Current state**: `mcp.buywhere.ai` likely points to `buywhere-api` service.

**Fix**: Update DNS CNAME to point to `buywhere-mcp` service.

**Option A: Cloud DNS** (if using Google Cloud DNS)
```bash
# Get the actual Cloud Run URL for MCP service
MCP_URL=$(gcloud run services describe buywhere-mcp \
  --project=gaia-calendar-488606 --region=asia-southeast1 --format="value(status.url)")

# Extract the domain (remove https://)
MCP_DOMAIN="${MCP_URL#https://}"

# Update DNS record
gcloud dns record-sets update mcp.buywhere.ai \
  --rrdatas="$MCP_DOMAIN" \
  --ttl=300 \
  --type=CNAME \
  --zone=<YOUR_ZONE_NAME>
```

**Option B: External DNS Provider** (e.g., Cloudflare, Route53)
1. Get the `buywhere-mcp` Cloud Run URL from `gcloud`
2. In your DNS provider:
   - Record: `mcp.buywhere.ai`
   - Type: `CNAME`
   - Value: The full `buywhere-mcp` Cloud Run domain
   - TTL: 300 seconds

### Phase 3: Verify Topology

**Run the verification script**:
```bash
./scripts/fix-mcp-topology.sh
```

**Manual verification**:
```bash
# Test MCP endpoints
curl -v https://mcp.buywhere.ai/healthz
# Expected: HTTP 200, body: {"status":"ok"}

curl -v https://mcp.buywhere.ai/health
# Expected: HTTP 200, body includes "server":"mcp"

# Verify DNS resolution
nslookup mcp.buywhere.ai
# Expected: Points to buywhere-mcp Cloud Run domain
```

## Workflow Updates

The `deploy-mcp-cloud-run-production.yml` workflow is **already correct**:
- Line 176 probes `/health` ✓ (not `/healthz`)
- Line 171 falls back to `https://mcp.buywhere.ai` (correct domain)

**Note**: The issue description was inaccurate when it stated workflows probe `/healthz`. They actually probe `/health`, which is the correct behavior.

## Post-Fix Verification

Once DNS is updated, verify:

### 1. Health Endpoints
```bash
curl https://mcp.buywhere.ai/health | jq .
# Must include: "server":"mcp"

curl https://mcp.buywhere.ai/healthz
# Must return HTTP 200 with {"status":"ok"}
```

### 2. MCP Functionality
```bash
curl -X POST https://mcp.buywhere.ai/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"get_metadata","params":{},"id":1}'
# Should require API key, not return "Not found"
```

### 3. Knative Probes
The `buywhere-mcp` service should show healthy probes in Cloud Run:
```bash
gcloud run services describe buywhere-mcp \
  --project=gaia-calendar-488606 --region=asia-southeast1 \
  --format="table(status.conditions.name,status.conditions.status)"
```

## Files Modified

- `scripts/fix-mcp-topology.sh` — Diagnostic and remediation script
- `docs/mcp-topology-fix.md` — This document

## Timeline

- **2026-05-16 02:34**: Issue discovered during routine health check
- **2026-05-16 02:35**: Root cause identified (DNS misconfiguration)
- **2026-05-16**: Remediation steps documented and scripted

## Blockers & Dependencies

- **Requires**: GCP access (gcloud CLI + Cloud Run permissions)
- **Requires**: DNS provider access (Cloud DNS or external)
- **Depends on**: [BUY-18335](/BUY/issues/BUY-18335) (parent issue)

## Success Criteria (Acceptance)

✓ `mcp.buywhere.ai/healthz` returns HTTP 200  
✓ `mcp.buywhere.ai/health` includes `"server":"mcp"` in response  
✓ DNS resolution points to correct Cloud Run service  
✓ Workflows pass health check during deployment  
✓ UptimeRobot monitoring shows both endpoints as "Up"  

## Contacts & Escalation

- **Owner**: [@Ops](agent://ops) (DevOps)
- **Escalate to**: [@Bolt](agent://bolt) (VP DevOps) if GCP access needed
