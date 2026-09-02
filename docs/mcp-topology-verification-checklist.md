# MCP Topology Verification Checklist — BUY-18347

Use this checklist to verify the MCP topology fix is complete.

## Pre-Fix Verification

Run this before making any changes to establish baseline:

```bash
echo "=== BEFORE FIX ==="
curl -s https://mcp.buywhere.ai/healthz | head -c 100
echo "  ↑ Should show 404 or 'not found'"

curl -s https://mcp.buywhere.ai/health | head -c 100
echo "  ↑ Should show status:ok WITHOUT server:mcp"
```

**Expected (broken state)**:
```
{"error":"Not found"}
{"status":"ok","ts":"2026-05-16T..."}
```

## Phase 1: Verify Cloud Run Service

- [ ] Cloud Run service `buywhere-mcp` exists and is deployed
  ```bash
  gcloud run services describe buywhere-mcp \
    --project=gaia-calendar-488606 \
    --region=asia-southeast1
  ```
  
- [ ] Service is in status "ACTIVE" or "RUNNING"
  
- [ ] Service has at least 1 ready revision
  
- [ ] Record the service URL:
  ```
  MCP_URL: _______________________________
  ```

- [ ] Service can be reached directly:
  ```bash
  curl -I https://{MCP_URL}/health
  # Should return HTTP 200
  ```

## Phase 2: Update DNS

- [ ] Get current DNS records for mcp.buywhere.ai:
  ```bash
  # Using Cloud DNS:
  gcloud dns record-sets list --zone={ZONE_NAME} --filter="name:mcp.buywhere.ai"
  
  # OR using nslookup:
  nslookup mcp.buywhere.ai
  ```

- [ ] Record current CNAME value:
  ```
  CURRENT_CNAME: _______________________________
  ```

- [ ] Update DNS CNAME record to point to MCP Cloud Run service:
  ```bash
  # Using Cloud DNS:
  gcloud dns record-sets update mcp.buywhere.ai \
    --rrdatas="{MCP_URL#https://}" \
    --ttl=300 \
    --type=CNAME \
    --zone={ZONE_NAME}
  
  # OR update in your DNS provider UI:
  # Record: mcp.buywhere.ai
  # Type: CNAME
  # Value: {MCP_CLOUD_RUN_DOMAIN}
  # TTL: 300
  ```

- [ ] Verify DNS record was updated:
  ```bash
  nslookup mcp.buywhere.ai
  # Should show MCP Cloud Run domain, not API domain
  ```

- [ ] Wait for DNS propagation (usually 5-10 minutes):
  ```bash
  # Keep running until it resolves correctly:
  watch 'nslookup mcp.buywhere.ai | grep "Name:"'
  ```

## Phase 3: Verify Post-Fix

Once DNS is updated, verify the topology is correct:

```bash
echo "=== AFTER FIX ==="
```

- [ ] Test `/healthz` endpoint:
  ```bash
  curl -v https://mcp.buywhere.ai/healthz
  # Should return: HTTP 200 with {"status":"ok"}
  ```

- [ ] Test `/health` endpoint:
  ```bash
  curl -v https://mcp.buywhere.ai/health
  # Should include: "server":"mcp"
  curl -s https://mcp.buywhere.ai/health | jq .
  ```

- [ ] Verify response includes catalog info:
  ```bash
  curl -s https://mcp.buywhere.ai/health | jq '.catalog'
  # Should show total_products count
  ```

- [ ] Test `/mcp` endpoint requires authentication:
  ```bash
  curl -X POST https://mcp.buywhere.ai/mcp \
    -H "Content-Type: application/json" \
    -d '{}'
  # Should return: MISSING_API_KEY error
  ```

- [ ] Run diagnostic script:
  ```bash
  cd /home/paperclip/buywhere-api
  ./scripts/fix-mcp-topology.sh
  # All checks should pass with ✓
  ```

## Phase 4: Verify Cloud Run Health Probes

- [ ] Check Cloud Run service health in GCP console:
  ```bash
  gcloud run services describe buywhere-mcp \
    --project=gaia-calendar-488606 \
    --region=asia-southeast1 \
    --format="table(status.conditions.name,status.conditions.status)"
  ```

- [ ] All conditions should show "True"
  
- [ ] Check service revision logs for errors:
  ```bash
  gcloud logging read \
    "resource.type=cloud_run_revision AND resource.labels.service_name=buywhere-mcp" \
    --project=gaia-calendar-488606 \
    --limit=50 \
    --format=json | jq '.[] | select(.severity=="ERROR")'
  ```

## Phase 5: Monitor & Alert Setup

- [ ] Verify UptimeRobot monitors are updated:
  - [ ] Monitor for `https://mcp.buywhere.ai/health` exists and shows "Up"
  - [ ] Monitor for `https://mcp.buywhere.ai/healthz` exists and shows "Up"
  
- [ ] Verify Sentry is capturing MCP errors (if configured)
  
- [ ] Verify deployment workflow health check passes on next deploy:
  ```bash
  # Trigger manual deployment:
  gh workflow run deploy-mcp-cloud-run-production.yml \
    --repo anthropics/buywhere-api \
    --ref main
  ```

## Phase 6: API Contract Verification

After all checks pass:

- [ ] Both health endpoints return the correct contract:

  **API (`api.buywhere.ai/health`)**:
  ```json
  {"status":"ok","ts":"2026-05-16T..."}
  ```
  
  **MCP (`mcp.buywhere.ai/health`)**:
  ```json
  {
    "status":"ok",
    "server":"mcp",
    "ts":"2026-05-16T...",
    "catalog":{"total_products":NNNNNNN}
  }
  ```

- [ ] `/healthz` only exists on MCP service (not on API)
  
- [ ] Both services respond within SLA (< 500ms)

## Success Criteria

All of the following must be true:

✓ `mcp.buywhere.ai/healthz` returns HTTP 200  
✓ `mcp.buywhere.ai/health` includes `"server":"mcp"`  
✓ `api.buywhere.ai/health` does NOT include `"server":"mcp"`  
✓ DNS CNAME points to MCP Cloud Run domain  
✓ Cloud Run service shows all conditions as True  
✓ UptimeRobot monitors show both endpoints as Up  
✓ Deployment workflow health check passes  

## Troubleshooting

### DNS hasn't propagated yet
**Symptom**: `nslookup mcp.buywhere.ai` still shows old domain

**Fix**: Wait 5-15 minutes, then retry. DNS TTL might be cached.

### Service returns 404 on direct URL but works through DNS
**Symptom**: `curl https://{mcp-cloud-run-domain}/health` returns 404, but after DNS update works

**Cause**: Could be HTTPS certificate issues or missing domain mapping

**Fix**: Verify service has proper SSL certificate and domain mapping configured

### Health endpoint returns wrong response
**Symptom**: `/health` returns main API response instead of MCP response

**Cause**: DNS still pointing to wrong service

**Fix**: Verify DNS CNAME updated correctly, run `nslookup -type=CNAME mcp.buywhere.ai`

### Cloud Run service shows unhealthy
**Symptom**: `gcloud run services describe` shows conditions as False

**Cause**: Service may not be starting correctly

**Fix**: 
1. Check Cloud Run logs: `gcloud logging read resource.type=cloud_run_revision`
2. Verify Cloud SQL connection: Check `DATABASE_URL` secret exists and is valid
3. Redeploy service: Run `deploy-mcp-cloud-run-production.yml` workflow

## Sign-Off

Once all checks pass, sign off on the fix:

- **Verified by**: _____________________________
- **Date**: _____________________________
- **Commit**: [BUY-18347] Normalize MCP public topology and health contract
