#!/usr/bin/env bash
# backup-vector-db.sh — Nightly pg_dump of product_embeddings → R2
# BUY-76567: protect the embedding asset BEFORE rebuilding.
#
# Runs as a cron job (recommended: daily at 03:00 UTC).
# Requires: pg_dump, gzip, aws CLI (R2 is S3-compatible).
#
# Env vars (all required):
#   VECTOR_DB_URL        — PostgreSQL connection for product_embeddings
#   R2_ACCESS_KEY_ID     — Cloudflare R2 access key
#   R2_SECRET_ACCESS_KEY — Cloudflare R2 secret key
#   R2_BUCKET            — R2 bucket name (default: buywhere-backups)
#   R2_ACCOUNT_ID        — Cloudflare account ID (for endpoint URL)
#
# Output: R2 key = backups/vector-db/product_embeddings-YYYY-MM-DD.sql.gz
# Retention: 30 days (older backups deleted automatically).

set -euo pipefail

# --- Config ---
R2_BUCKET="${R2_BUCKET:-buywhere-backups}"
R2_PREFIX="backups/vector-db"
RETENTION_DAYS=30
TIMESTAMP=$(date -u +%Y-%m-%d)
DUMP_FILE="/tmp/product_embeddings-${TIMESTAMP}.sql.gz"
R2_KEY="${R2_PREFIX}/product_embeddings-${TIMESTAMP}.sql.gz"
R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

# --- Preflight ---
for var in VECTOR_DB_URL R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_ACCOUNT_ID; do
  if [ -z "${!var:-}" ]; then
    echo "[backup] ERROR: $var is not set" >&2
    exit 1
  fi
done

command -v pg_dump >/dev/null 2>&1 || { echo "[backup] ERROR: pg_dump not found" >&2; exit 1; }
command -v aws >/dev/null 2>&1 || { echo "[backup] ERROR: aws CLI not found" >&2; exit 1; }

# --- Dump ---
echo "[backup] Dumping product_embeddings from vector-db..."
pg_dump "$VECTOR_DB_URL" \
  --table=product_embeddings \
  --no-owner \
  --no-privileges \
  --format=plain \
  | gzip -9 > "$DUMP_FILE"

DUMP_SIZE=$(stat -c%s "$DUMP_FILE" 2>/dev/null || stat -f%z "$DUMP_FILE")
echo "[backup] Dump complete: $(numfmt --to=iec $DUMP_SIZE 2>/dev/null || echo "${DUMP_SIZE} bytes")"

# --- Upload to R2 ---
echo "[backup] Uploading to R2 s3://${R2_BUCKET}/${R2_KEY}..."
aws s3 cp "$DUMP_FILE" "s3://${R2_BUCKET}/${R2_KEY}" \
  --endpoint-url "$R2_ENDPOINT" \
  --region auto \
  --storage-class STANDARD \
  --quiet

echo "[backup] Upload complete"

# --- Cleanup local ---
rm -f "$DUMP_FILE"

# --- Prune old backups from R2 ---
echo "[backup] Pruning backups older than ${RETENTION_DAYS} days..."
CUTOFF_DATE=$(date -u -d "${RETENTION_DAYS} days ago" +%Y-%m-%d 2>/dev/null \
  || date -u -v-${RETENTION_DAYS}d +%Y-%m-%d)

# List all backup objects and delete those older than cutoff
aws s3 ls "s3://${R2_BUCKET}/${R2_PREFIX}/" \
  --endpoint-url "$R2_ENDPOINT" \
  --region auto \
  | awk '{print $4}' \
  | grep -E '^product_embeddings-[0-9]{4}-[0-9]{2}-[0-9]{2}\.sql\.gz$' \
  | while read -r key; do
      # Extract date from filename
      FILE_DATE=$(echo "$key" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}')
      if [[ "$FILE_DATE" < "$CUTOFF_DATE" ]]; then
        echo "[backup] Deleting old backup: $key"
        aws s3 rm "s3://${R2_BUCKET}/${R2_PREFIX}/${key}" \
          --endpoint-url "$R2_ENDPOINT" \
          --region auto \
          --quiet
      fi
    done

echo "[backup] Done — backup ${TIMESTAMP} uploaded, old backups pruned"
