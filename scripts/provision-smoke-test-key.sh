#!/usr/bin/env bash
# scripts/provision-smoke-test-key.sh
# Provisions a test API key in the local/staging database for smoke test verification.
#
# Usage:
#   export DATABASE_URL=postgresql://user:pass@host:5432/db
#   ./scripts/provision-smoke-test-key.sh                    # generates a new key
#   ./scripts/provision-smoke-test-key.sh --key bw_mytest    # use specific key
#   ./scripts/provision-smoke-test-key.sh --tier pro         # override tier (default: enterprise)
#
# Outputs the raw API key to stdout. Pipe to your .env or CI secret store.

set -euo pipefail

KEY_NAME="${SMOKE_TEST_KEY_NAME:-smoke-test-runner}"
TIER="enterprise"
CUSTOM_KEY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --key)   CUSTOM_KEY="$2"; shift 2 ;;
    --tier)  TIER="$2";        shift 2 ;;
    --name)  KEY_NAME="$2";    shift 2 ;;
    *)       echo "Unknown: $1"; exit 1 ;;
  esac
done

: "${DATABASE_URL:?DATABASE_URL must be set}"

if [ -n "$CUSTOM_KEY" ]; then
  RAW_KEY="$CUSTOM_KEY"
else
  RAW_KEY="bw_test_$(uuidgen 2>/dev/null || python3 -c 'import uuid; print(uuid.uuid4().hex)' 2>/dev/null || date +%s | md5sum | head -c 32)"
fi

# Hash the key using SHA-256 (same algorithm as apiKey.ts)
if command -v sha256sum &>/dev/null; then
  KEY_HASH=$(echo -n "$RAW_KEY" | sha256sum | cut -d' ' -f1)
elif command -v python3 &>/dev/null; then
  KEY_HASH=$(python3 -c "import hashlib; print(hashlib.sha256('$RAW_KEY'.encode()).hexdigest())")
else
  echo "ERROR: need sha256sum or python3"
  exit 1
fi

# Determine psql flags from DATABASE_URL
PSQL_CMD="psql ${DATABASE_URL}"

echo "Provisioning smoke-test API key..."
echo "  Name:  $KEY_NAME"
echo "  Tier:  $TIER"

# Check schema: does email_verified exist?
HAS_EMAIL_VERIFIED=$($PSQL_CMD -t -c "
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_name='api_keys' AND column_name='email_verified';
" 2>/dev/null | tr -d ' ')

# Generate a UUID for the id column
if command -v uuidgen &>/dev/null; then
  KEY_ID=$(uuidgen)
else
  KEY_ID=$(python3 -c 'import uuid; print(str(uuid.uuid4()))' 2>/dev/null || date +%s | md5sum | head -c 8)
fi

# Build INSERT dynamically to handle schema differences
INSERT_COLS="id, key_hash, name, tier, is_active, signup_channel, developer_id, rpm_limit, daily_limit"
INSERT_VALS="'${KEY_ID}', '${KEY_HASH}', '${KEY_NAME}', '${TIER}', true, 'smoke_test', 'provisioned'"
INSERT_VALS="$INSERT_VALS, $( [ "$TIER" = "enterprise" ] && echo "1000" || echo "60" )"
INSERT_VALS="$INSERT_VALS, $( [ "$TIER" = "enterprise" ] && echo "100000" || echo "1000" )"

if [ "$HAS_EMAIL_VERIFIED" = "1" ]; then
  INSERT_COLS="$INSERT_COLS, email_verified"
  INSERT_VALS="$INSERT_VALS, true"
fi

$PSQL_CMD -q -c "
  INSERT INTO api_keys (${INSERT_COLS})
  VALUES (${INSERT_VALS})
  ON CONFLICT (key_hash) DO UPDATE
    SET is_active = true, last_used_at = NOW()
    RETURNING id;
" 2>&1 | grep -v "^$"

echo ""
echo "=== SMOKE TEST API KEY ==="
echo "$RAW_KEY"
echo "=========================="
echo ""
echo "Use: export SMOKE_TEST_API_KEY=$RAW_KEY"
