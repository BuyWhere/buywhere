#!/usr/bin/env bash
# run-buy-57568-worker-disk-enforcement.sh — BUY-57568
# Worker node disk-space enforcement — cron wrapper.
#
# Runs the enforcement engine every 10 minutes via cron.
# Produces evidence reports to BUY-57568-evidence/.
# Logs to logs/buy-57568-disk-enforcement.log.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENFORCER="$REPO_ROOT/scripts/worker-node-disk-enforcement.sh"
EVIDENCE_DIR="$REPO_ROOT/BUY-57568-evidence"
EVIDENCE_REPORT="$EVIDENCE_DIR/enforcement-latest.json"
LOG_FILE="$REPO_ROOT/logs/buy-57568-disk-enforcement.log"

mkdir -p "$EVIDENCE_DIR" "$REPO_ROOT/logs"

RUN_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*" >> "$LOG_FILE"; }
echo_it() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*"; }

if [[ ! -x "$ENFORCER" ]]; then
  log "ERROR: enforcement engine not found at $ENFORCER"
  echo_it "ERROR: enforcement engine not found at $ENFORCER"
  exit 1
fi

log "BUY-57568 cron wrapper starting"
echo_it "BUY-57568: worker node disk-space enforcement starting"

# Run the enforcement engine with --apply (real enforcement, not dry-run)
bash "$ENFORCER" \
  --apply \
  --enforce-pct=85 \
  --critical-pct=95 \
  --keep=48 2>&1 | tee -a "$LOG_FILE"

ENFORCER_EXIT=${PIPESTATUS[0]}

# Capture summary into evidence report
DISK_PCT=$(df -Pk / | awk 'NR==2 {gsub("%","",$5); print $5}')
DISK_FREE_KB=$(df -Pk / | awk 'NR==2 {print $4}')
DISK_FREE_GB=$(( DISK_FREE_KB / 1024 / 1024 ))

STATUS_TEXT="ok"
if [ "$ENFORCER_EXIT" != "0" ]; then
  STATUS_TEXT="alert"
fi

cat > "$EVIDENCE_REPORT" << REPORT_EOF
{
  "ts": "$RUN_TS",
  "issue": "BUY-57568",
  "enforce_pct": 85,
  "critical_pct": 95,
  "keep_hours": 48,
  "disk_root_pct": $DISK_PCT,
  "disk_root_free_gb": $DISK_FREE_GB,
  "exit_code": $ENFORCER_EXIT,
  "status": "$STATUS_TEXT"
}
REPORT_EOF

echo_it "BUY-57568: enforcement ${STATUS_TEXT} disk=${DISK_PCT}% free=${DISK_FREE_GB}GB"
echo_it "Evidence: $EVIDENCE_REPORT"
log "BUY-57568 cron wrapper complete exit=$ENFORCER_EXIT disk=${DISK_PCT}% free=${DISK_FREE_GB}GB"

exit "$ENFORCER_EXIT"
