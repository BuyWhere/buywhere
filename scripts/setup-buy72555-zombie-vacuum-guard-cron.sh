#!/usr/bin/env bash
# BUY-72555 idempotent cron setup for catalog.products autovacuum guard.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNNER="$SCRIPT_DIR/run-buy72555-zombie-vacuum-guard-cron.sh"
LOG_FILE="$REPO_ROOT/logs/buy72555-zombie-vacuum-guard.log"
MARKER="buy72555-zombie-vacuum-guard-cron"
CRON_JOB="7 * * * * cd $REPO_ROOT && bash $RUNNER >> $LOG_FILE 2>&1 # BUY-72555: catalog.products autovacuum guard -- $MARKER"

mkdir -p "$REPO_ROOT/logs" "$REPO_ROOT/data/reports"

if [[ ! -x "$RUNNER" ]]; then
  echo "ERROR: runner missing or not executable: $RUNNER" >&2
  exit 1
fi

CRONTAB="$(crontab -l 2>/dev/null || true)"
CLEANED="$(printf '%s\n' "$CRONTAB" | grep -v "$MARKER" || true)"
printf '%s\n%s\n' "$CLEANED" "$CRON_JOB" | crontab -

COUNT="$(crontab -l | grep -c "$MARKER" || true)"
if [[ "$COUNT" -ne 1 ]]; then
  echo "ERROR: expected exactly 1 $MARKER entry, found $COUNT" >&2
  exit 1
fi

echo "Installed BUY-72555 hourly cron: $CRON_JOB"
echo "Run once with: bash $RUNNER"
