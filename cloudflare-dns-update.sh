#!/usr/bin/env bash
set -euo pipefail

# Cloudflare DNS Update for buywhere.ai Railway SSL verification
# Issue: BUY-21507
# Requires: CLOUDFLARE_API_TOKEN with Zone:Read + DNS:Edit permissions
#
# Usage: CLOUDFLARE_API_TOKEN="..." bash cloudflare-dns-update.sh

: "${CLOUDFLARE_API_TOKEN:?Must set CLOUDFLARE_API_TOKEN}"

ACCOUNT_ID="b6a1b2b6bcbd4011ffe40a3cc540b1b0"
CF_API="https://api.cloudflare.com/client/v4"

echo "=== Step 1: Get Zone ID for buywhere.ai ==="
ZONE_RESP=$(curl -s -X GET "$CF_API/zones?name=buywhere.ai" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json")
ZONE_ID=$(echo "$ZONE_RESP" | jq -r '.result[0].id')
if [ -z "$ZONE_ID" ] || [ "$ZONE_ID" = "null" ]; then
  echo "ERROR: Could not find zone. Response:"
  echo "$ZONE_RESP" | jq .
  exit 1
fi
echo "Zone ID: $ZONE_ID"

echo "=== Step 2: Add TXT _railway-verify record ==="
curl -s -X POST "$CF_API/zones/$ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "TXT",
    "name": "_railway-verify",
    "content": "railway-verify=002b75c091e1cae30edae2e49c63709c4a9745d80ac18545affc96f747cf8732",
    "ttl": 120
  }' | jq .

echo "=== Step 3: Add TXT _railway-verify.www record ==="
curl -s -X POST "$CF_API/zones/$ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "TXT",
    "name": "_railway-verify.www",
    "content": "railway-verify=784cd39c48be5e4753fb302007f74bd9f833f8927382558a9fccf0287cb310e7",
    "ttl": 120
  }' | jq .

echo "=== Step 4: Find and DELETE broken CNAME www → buywhere.ai. ==="
DNS_RECORDS=$(curl -s -X GET "$CF_API/zones/$ZONE_ID/dns_records?type=CNAME&name=www.buywhere.ai" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json")
DEL_ID=$(echo "$DNS_RECORDS" | jq -r '.result[] | select(.content == "buywhere.ai.") | .id')
if [ -n "$DEL_ID" ] && [ "$DEL_ID" != "null" ]; then
  echo "Deleting broken self-referencing CNAME (record ID: $DEL_ID)..."
  curl -s -X DELETE "$CF_API/zones/$ZONE_ID/dns_records/$DEL_ID" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json" | jq .
else
  echo "No broken self-referencing CNAME found — skipping delete."
fi

echo "=== Step 5: Update/Add CNAME www → d11geaq0.up.railway.app ==="
EXISTING_CNAME=$(echo "$DNS_RECORDS" | jq -r '.result[] | select(.content != "buywhere.ai.") | .id')
if [ -n "$EXISTING_CNAME" ] && [ "$EXISTING_CNAME" != "null" ]; then
  echo "Updating existing CNAME record (ID: $EXISTING_CNAME)..."
  curl -s -X PUT "$CF_API/zones/$ZONE_ID/dns_records/$EXISTING_CNAME" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "type": "CNAME",
      "name": "www",
      "content": "d11geaq0.up.railway.app",
      "ttl": 120,
      "proxied": false
    }' | jq .
else
  echo "Creating new CNAME record..."
  curl -s -X POST "$CF_API/zones/$ZONE_ID/dns_records" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "type": "CNAME",
      "name": "www",
      "content": "d11geaq0.up.railway.app",
      "ttl": 120,
      "proxied": false
    }' | jq .
fi

echo ""
echo "=== DNS update complete ==="
echo "Run: curl -s \"$CF_API/zones/$ZONE_ID/dns_records\" -H \"Authorization: Bearer \$CLOUDFLARE_API_TOKEN\" | jq '.result[] | {type, name, content}'"
echo "to verify records."
