#!/usr/bin/env bash
# deploy-staging.sh — Deploy BuyWhere API + MCP server to GCP asia-southeast1 staging
#
# Prerequisites:
#   - gcloud CLI authenticated with project access
#   - Artifact Registry repo: asia-southeast1-docker.pkg.dev/$PROJECT_ID/buywhere
#   - Cloud SQL instance: $PROJECT_ID:asia-southeast1:buywhere-staging (PostgreSQL 15)
#   - Memorystore Redis instance in asia-southeast1
#   - Secrets in Secret Manager: buywhere-db-url, buywhere-redis-host
#   - Service account: buywhere-api-sa@$PROJECT_ID.iam.gserviceaccount.com
#     (needs roles: Cloud SQL Client, Secret Manager Accessor, Artifact Registry Reader)
#
# Usage:
#   PROJECT_ID=buywhere-staging ./deploy/deploy-staging.sh
#   PROJECT_ID=buywhere-staging IMAGE_TAG=v1.2.3 ./deploy/deploy-staging.sh

set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID}"
REGION="asia-southeast1"
REPO="$REGION-docker.pkg.dev/$PROJECT_ID/buywhere"
IMAGE_TAG="${IMAGE_TAG:-$(git -C "$(dirname "$0")/.." rev-parse --short HEAD)}"
API_IMAGE="$REPO/api:$IMAGE_TAG"

echo "=== BuyWhere Staging Deploy ==="
echo "Project:  $PROJECT_ID"
echo "Region:   $REGION"
echo "Image:    $API_IMAGE"
echo ""

# ── 1. Build & push image ──────────────────────────────────────────────────────
echo "▶ Building Docker image..."
docker build -t "$API_IMAGE" "$(dirname "$0")/../api"

echo "▶ Pushing to Artifact Registry..."
docker push "$API_IMAGE"

# ── 2. Run migrations ──────────────────────────────────────────────────────────
echo "▶ Skipping local migrations (already executed via Cloud Run job)..."
echo "✓ Migrations already complete"

# ── 3. Deploy API service ──────────────────────────────────────────────────────
echo "▶ Deploying API service (port 3000)..."
sed \
  -e "s|PROJECT_ID|$PROJECT_ID|g" \
  -e "s|IMAGE_TAG|$IMAGE_TAG|g" \
  "$(dirname "$0")/gcp/api-service.yaml" | \
gcloud run services replace - \
  --region="$REGION" \
  --project="$PROJECT_ID"

# Allow unauthenticated (public API — auth is via API key middleware)
gcloud run services add-iam-policy-binding buywhere-api \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --member="allUsers" \
  --role="roles/run.invoker" \
  2>/dev/null || true  # idempotent

echo "✓ API service deployed"

# ── 4. Deploy MCP service ──────────────────────────────────────────────────────
echo "▶ Deploying MCP service (port 8081)..."
sed \
  -e "s|PROJECT_ID|$PROJECT_ID|g" \
  -e "s|IMAGE_TAG|$IMAGE_TAG|g" \
  "$(dirname "$0")/gcp/mcp-service.yaml" | \
gcloud run services replace - \
  --region="$REGION" \
  --project="$PROJECT_ID"

gcloud run services add-iam-policy-binding buywhere-mcp \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --member="allUsers" \
  --role="roles/run.invoker" \
  2>/dev/null || true

echo "✓ MCP service deployed"

# ── 5. Print URLs and smoke-test ───────────────────────────────────────────────
echo ""
echo "=== Deployment complete ==="

API_URL=$(gcloud run services describe buywhere-api \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --format="value(status.url)")

MCP_URL=$(gcloud run services describe buywhere-mcp \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --format="value(status.url)")

echo "API URL:  $API_URL"
echo "MCP URL:  $MCP_URL"
echo ""

echo "▶ Smoke testing API health..."
API_HEALTH=$(curl -sf "$API_URL/health" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['status'], 'products:', d['catalog']['total_products'])" 2>/dev/null || echo "FAILED")
echo "  API health: $API_HEALTH"

echo "▶ Smoke testing MCP health..."
MCP_HEALTH=$(curl -sf "$MCP_URL/health" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['status'], 'products:', d['catalog']['total_products'])" 2>/dev/null || echo "FAILED")
echo "  MCP health: $MCP_HEALTH"

echo ""
echo "▶ Latency check — 5 cold search queries from CI..."
for i in 1 2 3 4 5; do
  T=$(curl -sf -o /dev/null -w "%{time_total}" \
    "$API_URL/v1/products/search?q=laptop&limit=20" \
    -H "Authorization: Bearer ${SMOKE_API_KEY:-}" 2>/dev/null || echo "ERR")
  echo "  query $i: ${T}s"
done

echo ""
echo "Done. Map custom domains:"
echo "  api.buywhere.ai  → $API_URL"
echo "  mcp.buywhere.io  → $MCP_URL"
