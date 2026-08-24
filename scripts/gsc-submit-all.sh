#!/usr/bin/env bash
# gsc-submit-all.sh — Re-submit every sub-sitemap listed under a sitemap index
# to Google Search Console via the Webmasters API (PUT on
# webmasters/v3/sites/{site}/sitemaps/{feedpath}).
#
# BUY-23771 A6 — GSC submission cadence.
#
# Requirements:
#   - gcloud auth OR a service-account key with Webmasters scope
#     (this script expects a local SA key at GSC_SA_KEY, defaults to
#     /home/paperclip/.secrets/gsc-reader.json).
#   - python3 with PyJWT.
#
# Env:
#   GSC_SA_KEY       Path to service-account JSON (default: /home/paperclip/.secrets/gsc-reader.json)
#   GSC_SITE         Site URL form (default: sc-domain:buywhere.ai)
#   GSC_INDEX_URL    Sitemap index URL (default: https://buywhere.ai/sitemap.xml)
#
# Usage:
#   ./scripts/gsc-submit-all.sh                # submit all sub-sitemaps listed in the index
#   ./scripts/gsc-submit-all.sh --dry-run      # list the URLs that would be submitted
#   ./scripts/gsc-submit-all.sh --skip-sg      # skip sub-sitemaps flagged as broken/missing (e.g. sitemap-products-sg.xml)

set -euo pipefail

GSC_SA_KEY="${GSC_SA_KEY:-/home/paperclip/.secrets/gsc-reader.json}"
GSC_SITE="${GSC_SITE:-sc-domain:buywhere.ai}"
GSC_INDEX_URL="${GSC_INDEX_URL:-https://buywhere.ai/sitemap.xml}"

dry_run=0
skip_sg=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=1 ;;
    --skip-sg) skip_sg=1 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

command -v python3 >/dev/null || { echo "python3 missing" >&2; exit 1; }
python3 -c 'import jwt' 2>/dev/null || { echo "PyJWT not installed (pip install PyJWT)" >&2; exit 1; }
[[ -f "$GSC_SA_KEY" ]] || { echo "GSC SA key not found at $GSC_SA_KEY" >&2; exit 1; }

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

# Fetch sitemap index
curl -sS -o "$tmpdir/sitemap.xml" "$GSC_INDEX_URL"
# Extract sub-sitemap URLs
grep -oE '<loc>[^<]+</loc>' "$tmpdir/sitemap.xml" \
  | sed 's|<loc>||;s|</loc>||' \
  | grep -vE 'sitemap\.xml$' \
  > "$tmpdir/sub.txt" || true
# Include the index itself
echo "$GSC_INDEX_URL" >> "$tmpdir/sub.txt"
sort -u "$tmpdir/sub.txt" -o "$tmpdir/sub.txt"

if [[ "$skip_sg" -eq 1 ]]; then
  grep -v 'sitemap-products-sg\.xml' "$tmpdir/sub.txt" > "$tmpdir/sub.filtered" || true
  mv "$tmpdir/sub.filtered" "$tmpdir/sub.txt"
fi

echo "Sub-sitemaps to submit (count: $(wc -l < "$tmpdir/sub.txt")):"
sed 's|^|  - |' "$tmpdir/sub.txt"

if [[ "$dry_run" -eq 1 ]]; then
  echo "Dry-run: not submitting."
  exit 0
fi

# Mint SA token + PUT each sub-sitemap
GSC_SA_KEY="$GSC_SA_KEY" GSC_SITE="$GSC_SITE" python3 - "$tmpdir/sub.txt" <<'PY'
import json, os, sys, urllib.parse, urllib.request, urllib.error, jwt
from datetime import datetime, timezone

sub_path = sys.argv[1]
with open(sub_path) as f:
    urls = [line.strip() for line in f if line.strip()]

data = json.load(open(os.environ["GSC_SA_KEY"]))
now = int(datetime.now(timezone.utc).timestamp())
signed = jwt.encode(
    {"iss": data["client_email"],
     "scope": "https://www.googleapis.com/auth/webmasters",
     "aud": data["token_uri"],
     "iat": now, "exp": now + 3600},
    data["private_key"], algorithm="RS256")
tok = json.loads(urllib.request.urlopen(urllib.request.Request(
    "https://oauth2.googleapis.com/token",
    data=f"grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion={signed}".encode(),
    headers={"Content-Type": "application/x-www-form-urlencoded"},
    timeout=30)).read())["access_token"]

ok = 0
fail = 0
for url in urls:
    enc = urllib.parse.quote(url, safe="")
    endpoint = f"https://www.googleapis.com/webmasters/v3/sites/{os.environ['GSC_SITE']}/sitemaps/{enc}"
    req = urllib.request.Request(endpoint, method="PUT",
        headers={"Authorization": f"Bearer {tok}", "Content-Length": "0"})
    try:
        urllib.request.urlopen(req, timeout=30).read()
        print(f"204 {url}")
        ok += 1
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:200]
        print(f"FAIL {e.code} {url}: {body}")
        fail += 1
    except Exception as e:
        print(f"FAIL {url}: {e}")
        fail += 1

print(f"---\nok={ok} fail={fail}")
sys.exit(0 if fail == 0 else 1)
PY
