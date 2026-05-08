#!/usr/bin/env bash
# scripts/provision-smoke-test-key.sh
# Provisions or updates a smoke-test API key and verifies the target endpoint.

set -euo pipefail

KEY_NAME="${SMOKE_TEST_KEY_NAME:-smoke-test-runner}"
TIER="enterprise"
CUSTOM_KEY=""
INSTANCE_CONNECTION_NAME="${SMOKE_TEST_INSTANCE_CONNECTION_NAME:-}"
CREDENTIAL_FILE="${SMOKE_TEST_CREDENTIAL_FILE:-}"
VERIFY_URL="${SMOKE_TEST_VERIFY_URL:-https://api.buywhere.ai/health}"
API_KEY_OUTPUT=""
USE_PROXY=false
DRY_RUN=false
FORCE=false
PROXY_HOST="127.0.0.1"
PROXY_PORT="${SMOKE_TEST_PROXY_PORT:-55432}"
SIGNUP_CHANNEL="${SMOKE_TEST_SIGNUP_CHANNEL:-smoke_test}"
DEVELOPER_ID="${SMOKE_TEST_DEVELOPER_ID:-provisioned-smoke-test}"
PROXY_PID=""

usage() {
  cat <<'EOF'
Usage:
  export DATABASE_URL=postgresql://user:pass@host:5432/db
  ./scripts/provision-smoke-test-key.sh [options]

Options:
  --key VALUE                Use a specific raw API key
  --tier VALUE               API tier to provision (default: enterprise)
  --name VALUE               API key name (default: smoke-test-runner)
  --instance VALUE           Cloud SQL instance connection name
  --credential-file PATH     Service account JSON for cloud-sql-proxy
  --proxy                    Start cloud-sql-proxy and connect over localhost
  --dry-run                  Print SQL and skip database mutation and verification
  --force                    Delete any existing row for this key hash before insert
  --verify-url URL           Endpoint to verify after provisioning
  --api-key-output PATH      Write the raw API key to a file with 0600 permissions
  --help                     Show this help text
EOF
}

log() {
  echo "$*" >&2
}

die() {
  log "ERROR: $*"
  exit 1
}

cleanup() {
  if [[ -n "$PROXY_PID" ]] && kill -0 "$PROXY_PID" 2>/dev/null; then
    kill "$PROXY_PID" 2>/dev/null || true
    wait "$PROXY_PID" 2>/dev/null || true
  fi
}

require_value() {
  local flag="$1"
  local value="${2:-}"
  [[ -n "$value" ]] || die "$flag requires a value"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --key)
      require_value "$1" "${2:-}"
      CUSTOM_KEY="$2"
      shift 2
      ;;
    --tier)
      require_value "$1" "${2:-}"
      TIER="$2"
      shift 2
      ;;
    --name)
      require_value "$1" "${2:-}"
      KEY_NAME="$2"
      shift 2
      ;;
    --instance)
      require_value "$1" "${2:-}"
      INSTANCE_CONNECTION_NAME="$2"
      shift 2
      ;;
    --credential-file)
      require_value "$1" "${2:-}"
      CREDENTIAL_FILE="$2"
      shift 2
      ;;
    --proxy)
      USE_PROXY=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --force)
      FORCE=true
      shift
      ;;
    --verify-url)
      require_value "$1" "${2:-}"
      VERIFY_URL="$2"
      shift 2
      ;;
    --api-key-output)
      require_value "$1" "${2:-}"
      API_KEY_OUTPUT="$2"
      shift 2
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

trap cleanup EXIT

[[ -n "${DATABASE_URL:-}" ]] || die "DATABASE_URL must be set"
command -v psql >/dev/null 2>&1 || die "psql must be installed"
command -v curl >/dev/null 2>&1 || die "curl must be installed"

case "$TIER" in
  enterprise)
    RPM_LIMIT=1000
    DAILY_LIMIT=100000
    ;;
  *)
    RPM_LIMIT=60
    DAILY_LIMIT=1000
    ;;
esac

if [[ -n "$CUSTOM_KEY" ]]; then
  RAW_KEY="$CUSTOM_KEY"
else
  if command -v python3 >/dev/null 2>&1; then
    RAW_KEY="$(python3 - <<'PY'
import secrets
print("bw_test_" + secrets.token_urlsafe(24))
PY
)"
  elif command -v uuidgen >/dev/null 2>&1; then
    RAW_KEY="bw_test_$(uuidgen | tr '[:upper:]' '[:lower:]')"
  else
    die "python3 or uuidgen is required to generate a key"
  fi
fi

if command -v python3 >/dev/null 2>&1; then
  KEY_HASH="$(python3 - "$RAW_KEY" <<'PY'
import hashlib
import sys
print(hashlib.sha256(sys.argv[1].encode("utf-8")).hexdigest())
PY
)"
elif command -v sha256sum >/dev/null 2>&1; then
  KEY_HASH="$(printf '%s' "$RAW_KEY" | sha256sum | awk '{print $1}')"
else
  die "python3 or sha256sum is required to hash the key"
fi

if command -v python3 >/dev/null 2>&1; then
  KEY_ID="$(python3 - <<'PY'
import uuid
print(str(uuid.uuid4()))
PY
)"
elif command -v uuidgen >/dev/null 2>&1; then
  KEY_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
else
  die "python3 or uuidgen is required to generate a UUID"
fi

ACTIVE_DATABASE_URL="$DATABASE_URL"

wait_for_proxy() {
  local attempt
  for attempt in $(seq 1 20); do
    if (echo >"/dev/tcp/${PROXY_HOST}/${PROXY_PORT}") >/dev/null 2>&1; then
      return 0
    fi
    if [[ -n "$PROXY_PID" ]] && ! kill -0 "$PROXY_PID" 2>/dev/null; then
      wait "$PROXY_PID" || true
      die "cloud-sql-proxy exited before accepting connections"
    fi
    sleep 1
  done
  die "Timed out waiting for cloud-sql-proxy on ${PROXY_HOST}:${PROXY_PORT}"
}

rewrite_database_url_for_proxy() {
  command -v python3 >/dev/null 2>&1 || die "python3 is required for --proxy URL rewriting"
  python3 - "$DATABASE_URL" "$PROXY_HOST" "$PROXY_PORT" <<'PY'
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
import sys

raw_url, host, port = sys.argv[1:4]
parts = urlsplit(raw_url)
query_items = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k not in {"host", "hostaddr", "port"}]
username = parts.username or ""
password = parts.password or ""
auth = username
if password:
    auth += f":{password}"
if auth:
    auth += "@"
db_path = parts.path or ""
new_netloc = f"{auth}{host}:{port}"
print(urlunsplit((parts.scheme, new_netloc, db_path, urlencode(query_items), "")))
PY
}

if [[ "$USE_PROXY" == true ]]; then
  [[ -n "$INSTANCE_CONNECTION_NAME" ]] || die "--instance is required with --proxy"
  command -v cloud-sql-proxy >/dev/null 2>&1 || die "cloud-sql-proxy must be installed or available in PATH when --proxy is used"
  if [[ -n "$CREDENTIAL_FILE" ]]; then
    [[ -f "$CREDENTIAL_FILE" ]] || die "Credential file not found: $CREDENTIAL_FILE"
  fi

  proxy_args=(
    "--address" "$PROXY_HOST"
    "--port" "$PROXY_PORT"
  )
  if [[ -n "$CREDENTIAL_FILE" ]]; then
    proxy_args+=("--credentials-file" "$CREDENTIAL_FILE")
  fi
  proxy_args+=("$INSTANCE_CONNECTION_NAME")

  log "Starting cloud-sql-proxy for ${INSTANCE_CONNECTION_NAME} on ${PROXY_HOST}:${PROXY_PORT}"
  cloud-sql-proxy "${proxy_args[@]}" >/tmp/cloud-sql-proxy.log 2>&1 &
  PROXY_PID=$!
  wait_for_proxy
  ACTIVE_DATABASE_URL="$(rewrite_database_url_for_proxy)"
fi

PSQL_BASE=(psql "$ACTIVE_DATABASE_URL" -v ON_ERROR_STOP=1 -X -q)
PSQL_VARS=(
  -v key_id="$KEY_ID"
  -v key_hash="$KEY_HASH"
  -v key_name="$KEY_NAME"
  -v tier="$TIER"
  -v signup_channel="$SIGNUP_CHANNEL"
  -v developer_id="$DEVELOPER_ID"
)

SCHEMA_ROWS="$("${PSQL_BASE[@]}" -At -F '|' -c "
  SELECT column_name, is_nullable, COALESCE(column_default, '')
  FROM information_schema.columns
  WHERE table_name = 'api_keys'
    AND table_schema = ANY (current_schemas(false))
  ORDER BY ordinal_position;
")"
[[ -n "$SCHEMA_ROWS" ]] || die "api_keys table not found in current schema search path"

declare -A COLUMN_PRESENT=()
declare -A COLUMN_NULLABLE=()
declare -A COLUMN_DEFAULT=()

while IFS='|' read -r column_name is_nullable column_default; do
  [[ -n "$column_name" ]] || continue
  COLUMN_PRESENT["$column_name"]=1
  COLUMN_NULLABLE["$column_name"]="$is_nullable"
  COLUMN_DEFAULT["$column_name"]="$column_default"
done <<<"$SCHEMA_ROWS"

declare -A INSERT_VALUE_MAP=(
  [id]=":'key_id'"
  [key_hash]=":'key_hash'"
  [name]=":'key_name'"
  [tier]=":'tier'"
  [is_active]="true"
  [signup_channel]=":'signup_channel'"
  [developer_id]=":'developer_id'"
  [rpm_limit]="$RPM_LIMIT"
  [daily_limit]="$DAILY_LIMIT"
  [email_verified]="true"
)

required_known_columns=(key_hash name tier is_active)
for required_column in "${required_known_columns[@]}"; do
  [[ -n "${COLUMN_PRESENT[$required_column]:-}" ]] || die "api_keys.${required_column} is missing"
done

supported_columns=(
  id
  key_hash
  name
  tier
  is_active
  signup_channel
  attribution_source
  utm_source
  utm_medium
  utm_campaign
  contact
  email
  use_case
  developer_id
  rpm_limit
  daily_limit
  created_at
  last_used_at
  email_verified
  email_verification_token
  email_verification_sent_at
  email_verification_expires_at
)

declare -A SUPPORTED_COLUMN_SET=()
for supported_column in "${supported_columns[@]}"; do
  SUPPORTED_COLUMN_SET["$supported_column"]=1
done

for present_column in "${!COLUMN_PRESENT[@]}"; do
  if [[ -z "${SUPPORTED_COLUMN_SET[$present_column]:-}" ]]; then
    if [[ "${COLUMN_NULLABLE[$present_column]}" == "NO" && -z "${COLUMN_DEFAULT[$present_column]}" ]]; then
      die "api_keys.${present_column} is NOT NULL without a default and is not handled by this script"
    fi
  fi
done

insert_columns=()
insert_values=()

for column_name in "${supported_columns[@]}"; do
  if [[ -n "${COLUMN_PRESENT[$column_name]:-}" && -n "${INSERT_VALUE_MAP[$column_name]:-}" ]]; then
    insert_columns+=("$column_name")
    insert_values+=("${INSERT_VALUE_MAP[$column_name]}")
  fi
done

[[ ${#insert_columns[@]} -gt 0 ]] || die "No insertable api_keys columns were discovered"

join_by() {
  local delimiter="$1"
  shift
  local first=1
  local item
  for item in "$@"; do
    if [[ $first -eq 1 ]]; then
      printf '%s' "$item"
      first=0
    else
      printf '%s%s' "$delimiter" "$item"
    fi
  done
}

INSERT_COLUMNS_SQL="$(join_by ', ' "${insert_columns[@]}")"
INSERT_VALUES_SQL="$(join_by ', ' "${insert_values[@]}")"

update_assignments=()
for column_name in "${insert_columns[@]}"; do
  case "$column_name" in
    id|key_hash|created_at)
      ;;
    *)
      update_assignments+=("${column_name} = EXCLUDED.${column_name}")
      ;;
  esac
done
if [[ -n "${COLUMN_PRESENT[last_used_at]:-}" ]]; then
  update_assignments+=("last_used_at = NOW()")
fi
UPDATE_SQL="$(join_by ', ' "${update_assignments[@]}")"
[[ -n "$UPDATE_SQL" ]] || UPDATE_SQL="key_hash = EXCLUDED.key_hash"

DELETE_SQL="DELETE FROM api_keys WHERE key_hash = :'key_hash';"
UPSERT_SQL="INSERT INTO api_keys (${INSERT_COLUMNS_SQL})
VALUES (${INSERT_VALUES_SQL})
ON CONFLICT (key_hash) DO UPDATE
SET ${UPDATE_SQL}
RETURNING id;"

log "Provisioning smoke-test API key"
log "  Name:        $KEY_NAME"
log "  Tier:        $TIER"
log "  Verify URL:  $VERIFY_URL"
if [[ "$USE_PROXY" == true ]]; then
  log "  Cloud SQL:   ${INSTANCE_CONNECTION_NAME} via proxy"
fi

if [[ "$DRY_RUN" == true ]]; then
  echo "=== DRY RUN ==="
  if [[ "$FORCE" == true ]]; then
    echo "$DELETE_SQL"
  fi
  echo "$UPSERT_SQL"
  echo ""
  echo "Variables:"
  echo "  key_id=$KEY_ID"
  echo "  key_hash=$KEY_HASH"
  echo "  key_name=$KEY_NAME"
  echo "  tier=$TIER"
  echo "  signup_channel=$SIGNUP_CHANNEL"
  echo "  developer_id=$DEVELOPER_ID"
  echo "  rpm_limit=$RPM_LIMIT"
  echo "  daily_limit=$DAILY_LIMIT"
  echo ""
  echo "Verification: skipped (--dry-run)"
else
  if [[ "$FORCE" == true ]]; then
    "${PSQL_BASE[@]}" "${PSQL_VARS[@]}" -c "$DELETE_SQL" >/dev/null
  fi

  INSERT_RESULT="$("${PSQL_BASE[@]}" "${PSQL_VARS[@]}" -At -c "$UPSERT_SQL")"
  [[ -n "$INSERT_RESULT" ]] || die "Insert succeeded but did not return an id"
  log "Database row id: $INSERT_RESULT"
fi

if [[ -n "$API_KEY_OUTPUT" ]]; then
  umask 077
  printf '%s\n' "$RAW_KEY" >"$API_KEY_OUTPUT"
  log "Wrote raw API key to $API_KEY_OUTPUT"
fi

if [[ "$DRY_RUN" == false ]]; then
  VERIFY_BODY_FILE="$(mktemp)"
  VERIFY_STATUS="$(curl -sS -o "$VERIFY_BODY_FILE" -w '%{http_code}' -H "Authorization: Bearer $RAW_KEY" "$VERIFY_URL")" || {
    rm -f "$VERIFY_BODY_FILE"
    die "Verification request failed for $VERIFY_URL"
  }
  VERIFY_BODY="$(cat "$VERIFY_BODY_FILE")"
  rm -f "$VERIFY_BODY_FILE"

  if [[ "$VERIFY_STATUS" != "200" ]]; then
    die "Verification failed: expected HTTP 200 from $VERIFY_URL, got $VERIFY_STATUS with body: $VERIFY_BODY"
  fi
  if [[ "$VERIFY_BODY" != *'"status":"ok"'* && "$VERIFY_BODY" != *'"status": "ok"'* ]]; then
    die "Verification failed: response body did not contain status ok: $VERIFY_BODY"
  fi

  echo "Verification result: OK ($VERIFY_URL -> HTTP $VERIFY_STATUS)"
  if [[ "$VERIFY_URL" == */health ]]; then
    log "WARNING: /health confirms endpoint reachability but does not prove the API key is required on that route"
  fi
fi

echo ""
echo "=== SMOKE TEST API KEY ==="
echo "$RAW_KEY"
echo "=== SMOKE TEST KEY HASH ==="
echo "$KEY_HASH"
echo "=========================="
echo ""
echo "Use: export SMOKE_TEST_API_KEY=$RAW_KEY"
