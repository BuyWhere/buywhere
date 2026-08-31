#!/usr/bin/env bash
# Sigil: Daily catalog quality snapshot wrapper
# Runs scripts/catalog_quality_snapshot.py --once against the canonical catalog DB.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$WORKSPACE/logs"
LOG_FILE="$LOG_DIR/catalog-quality-snapshot.log"

mkdir -p "$LOG_DIR"

ts() { date -u +%Y-%m-%dT%H:%TZ; }
log() { echo "[$(ts)] $*" | tee -a "$LOG_FILE"; }
log_err() { echo "[$(ts)] ERROR: $*" | tee -a "$LOG_FILE" >&2; }

# Canonical DB URL from data/.catalog_db_url
CATALOG_DB_URL_FILE="$WORKSPACE/data/.catalog_db_url"
if [[ ! -f "$CATALOG_DB_URL_FILE" ]]; then
    log_err "MISSING: $CATALOG_DB_URL_FILE — cannot run quality snapshot"
    exit 1
fi

CATALOG_DB_URL="$(cat "$CATALOG_DB_URL_FILE" | tr -d '[:space:]')"
if [[ -z "$CATALOG_DB_URL" ]]; then
    log_err "EMPTY: $CATALOG_DB_URL_FILE"
    exit 1
fi

# Run the snapshot
log "Starting catalog quality snapshot..."
(
    cd "$WORKSPACE"
    DATABASE_URL="$CATALOG_DB_URL" python3 scripts/catalog_quality_snapshot.py --once
) 1>>"$LOG_FILE" 2>&1 || {
    log_err "Catalog quality snapshot failed (exit $?)"
    exit 1
}

log "Catalog quality snapshot completed"
