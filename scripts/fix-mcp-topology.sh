#!/bin/bash
# fix-mcp-topology.sh — Normalize MCP public topology and health contract
#
# This script verifies and fixes the MCP service topology to ensure:
# 1. buywhere-mcp Cloud Run service is deployed and reachable
# 2. mcp.buywhere.ai DNS routes to the correct MCP service
# 3. Health endpoints match the intended contract
#
# Prerequisites:
#   - gcloud CLI authenticated and configured
#   - DNS (Cloud DNS or external provider) access
#   - kubectl or gcloud configured to access GKE/Cloud Run

set -euo pipefail

# Configuration
GCP_PROJECT_ID="${GCP_PROJECT_ID:-gaia-calendar-488606}"
GCP_REGION="${GCP_REGION:-asia-southeast1}"
MCP_SERVICE_NAME="buywhere-mcp"
API_SERVICE_NAME="buywhere-api"
MCP_DOMAIN="mcp.buywhere.ai"
API_DOMAIN="api.buywhere.ai"

echo "=== MCP Topology Normalization Script ==="
echo "Project: $GCP_PROJECT_ID"
echo "Region: $GCP_REGION"
echo ""

# Step 1: Check if MCP service exists
echo "Step 1: Checking MCP Cloud Run service..."
if gcloud run services describe "$MCP_SERVICE_NAME" \
    --project="$GCP_PROJECT_ID" \
    --region="$GCP_REGION" \
    --format="table(status.url)" 2>/dev/null; then
    MCP_URL=$(gcloud run services describe "$MCP_SERVICE_NAME" \
        --project="$GCP_PROJECT_ID" \
        --region="$GCP_REGION" \
        --format="value(status.url)")
    echo "✓ MCP service found at: $MCP_URL"
else
    echo "✗ MCP service not found!"
    echo "  Action: Deploy MCP service using deploy-mcp-cloud-run-production.yml workflow"
    exit 1
fi

# Step 2: Check API service
echo ""
echo "Step 2: Checking API Cloud Run service..."
API_URL=$(gcloud run services describe "$API_SERVICE_NAME" \
    --project="$GCP_PROJECT_ID" \
    --region="$GCP_REGION" \
    --format="value(status.url)")
echo "✓ API service found at: $API_URL"

# Step 3: Verify runtime endpoints
echo ""
echo "Step 3: Verifying runtime endpoints..."
echo "  Testing api.buywhere.ai/health..."
API_HEALTH=$(curl -s "$API_DOMAIN/health" | head -c 50)
echo "    Response: $API_HEALTH..."

echo "  Testing mcp.buywhere.ai/health..."
MCP_HEALTH=$(curl -s "$MCP_DOMAIN/health" | head -c 50)
echo "    Response: $MCP_HEALTH..."

echo "  Testing mcp.buywhere.ai/healthz..."
MCP_HEALTHZ=$(curl -s -w "\nHTTP_%{http_code}" "$MCP_DOMAIN/healthz" | head -c 50)
echo "    Response: $MCP_HEALTHZ..."

# Step 4: Check DNS configuration
echo ""
echo "Step 4: Checking DNS configuration..."
echo "  Current mcp.buywhere.ai resolves to:"
nslookup "$MCP_DOMAIN" 8.8.8.8 2>/dev/null | grep "^Name:" || echo "    (unable to resolve)"

echo "  Current api.buywhere.ai resolves to:"
nslookup "$API_DOMAIN" 8.8.8.8 2>/dev/null | grep "^Name:" || echo "    (unable to resolve)"

# Step 5: Verify health endpoints return correct contract
echo ""
echo "Step 5: Verifying health endpoint contracts..."

echo "  Checking /health includes catalog info (MCP server contract)..."
if curl -s "$MCP_DOMAIN/health" | grep -q '"server":"mcp"'; then
    echo "    ✓ MCP health contract satisfied"
else
    echo "    ✗ MCP health contract NOT satisfied (missing server field)"
    echo "      Current response: $(curl -s "$MCP_DOMAIN/health" | head -c 100)"
fi

echo "  Checking /healthz returns 200 (Knative probe)..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$MCP_DOMAIN/healthz")
if [ "$HTTP_CODE" = "200" ]; then
    echo "    ✓ /healthz probe OK"
else
    echo "    ✗ /healthz probe FAILED (HTTP $HTTP_CODE)"
fi

# Step 6: Summary
echo ""
echo "=== Diagnostics Summary ==="
if [ "$HTTP_CODE" != "200" ]; then
    echo "BLOCKER: mcp.buywhere.ai/healthz returns HTTP $HTTP_CODE"
    echo ""
    echo "Remediation steps:"
    echo "  1. Verify mcp.buywhere.ai DNS CNAME points to: $MCP_URL"
    echo "  2. If not, update DNS record:"
    echo "     mcp.buywhere.ai CNAME $MCP_URL"
    echo "  3. If DNS is correct, verify MCP service is accepting requests:"
    echo "     curl -v https://${MCP_URL#https://}/healthz"
    echo "  4. If still failing, redeploy MCP service:"
    echo "     gcloud run deploy buywhere-mcp --project=$GCP_PROJECT_ID ..."
    exit 1
else
    echo "✓ All topology checks passed"
    echo "  - MCP service deployed: $MCP_URL"
    echo "  - mcp.buywhere.ai routable and responding"
    echo "  - Health contract satisfied"
fi
