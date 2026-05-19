#!/usr/bin/env bash
set -euo pipefail

# BUY-21077: Frontend recovery script
# Run this on a machine with docker + gcloud to rebuild and deploy

echo "=== Step 1: Build Next.js in Docker ==="
docker build -f site.Dockerfile -t buywhere-site:latest .

echo "=== Step 2: Tag and push to GCP Artifact Registry ==="
GCP_PROJECT="gaia-calendar-488606"
GCP_REGION="asia-southeast1"
IMAGE="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT}/buywhere/site:latest"

docker tag buywhere-site:latest "$IMAGE"
docker push "$IMAGE"

echo "=== Step 3: Deploy to Cloud Run ==="
SERVICE="buywhere-site-production"
gcloud run deploy "$SERVICE" \
  --project "$GCP_PROJECT" \
  --region "$GCP_REGION" \
  --image "$IMAGE" \
  --port 3000 \
  --memory 2Gi \
  --cpu 2 \
  --min-instances 1 \
  --max-instances 10 \
  --allow-unauthenticated \
  --execution-environment gen2

echo "=== Step 4: Verify ==="
gcloud run services describe "$SERVICE" \
  --project "$GCP_PROJECT" \
  --region "$GCP_REGION" \
  --format "yaml(status.url)"

echo "=== Step 5: Run health check ==="
sleep 10
SITE_URL=$(gcloud run services describe "$SERVICE" \
  --project "$GCP_PROJECT" \
  --region "$GCP_REGION" \
  --format "value(status.url)")

HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$SITE_URL" --max-time 30)
if [ "$HTTP" = "200" ]; then
  echo "SUCCESS: Site returns HTTP 200"
else
  echo "WARNING: Site returns HTTP $HTTP — check logs"
fi

echo ""
echo "=== After Cloud Run is working, update nginx config to proxy to Cloud Run ==="
echo "Edit deploy/nginx/buywhere.ai.conf to change proxy_pass back to:"
echo "  proxy_pass https://${SERVICE}-3cjo6zft4q-as.a.run.app;"
echo "Then commit and push to auto-trigger nginx-deploy.yml"
