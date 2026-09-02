#!/usr/bin/env bash
# submit-gsc.sh — Idempotent Google Search Console sitemap submission.
#
# Usage:
#   SITE_URL=https://buywhere.ai bash scripts/submit-gsc.sh
#
# Prerequisites:
#   gcloud CLI authenticated with a service account that has Search Console
#   "Owner" or "Full User" permission on the property.
#
# Environment:
#   SITE_URL         — GSC property URL (default: https://buywhere.ai)
#   SITEMAP_PATH     — Sitemap path relative to site root (default: sitemap.xml)
#   COMPARE_SITEMAP  — Comparison sitemap path (default: sitemap-compare.xml)

set -euo pipefail

SITE_URL="${SITE_URL:-https://buywhere.ai}"
SITEMAP_PATH="${SITEMAP_PATH:-sitemap.xml}"
COMPARE_SITEMAP="${COMPARE_SITEMAP:-sitemap-compare.xml}"

SITEMAP_INDEX_URL="${SITE_URL}/${SITEMAP_PATH}"
COMPARE_SITEMAP_URL="${SITE_URL}/${COMPARE_SITEMAP}"

# Derive Google Search Console API endpoint base
GSC_API="https://www.googleapis.com/webmasters/v3"

# Obtain an access token via gcloud (service account must be authorized)
ACCESS_TOKEN="$(gcloud auth print-access-token 2>/dev/null || true)"
if [[ -z "$ACCESS_TOKEN" ]]; then
  echo "ERROR: Could not obtain gcloud access token." >&2
  echo "Run: gcloud auth application-default login" >&2
  exit 1
fi

submit_sitemap() {
  local sitemap_url="$1"
  local encoded_site encoded_sitemap

  # URL-encode the site and sitemap URLs for the GSC REST path
  encoded_site="$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$SITE_URL")"
  encoded_sitemap="$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$sitemap_url")"

  local url="${GSC_API}/sites/${encoded_site}/sitemaps/${encoded_sitemap}"

  echo "Submitting: $sitemap_url"
  response=$(curl -s -o /dev/null -w "%{http_code}" \
    -X PUT \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Length: 0" \
    "$url")

  if [[ "$response" == "200" || "$response" == "204" ]]; then
    echo "  OK (HTTP $response)"
  else
    echo "  WARNING: HTTP $response for $sitemap_url" >&2
    # Non-fatal: submission may already be present or property verification pending
  fi
}

echo "=== GSC Sitemap Submission ==="
echo "Site: $SITE_URL"
echo ""

submit_sitemap "$SITEMAP_INDEX_URL"
submit_sitemap "$COMPARE_SITEMAP_URL"

echo ""
echo "Done. GSC may take up to 48h to index the submitted sitemaps."
echo "Verify at: https://search.google.com/search-console/sitemaps?resource_id=$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$SITE_URL")"
