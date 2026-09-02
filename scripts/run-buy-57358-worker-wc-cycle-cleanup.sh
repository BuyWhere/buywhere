#!/usr/bin/env bash
# run-buy-57358-worker-wc-cycle-cleanup.sh
# BUY-57358: Worker node disk-space enforcement — WC cycle artifact cleanup on Oracle scrape workspace
#
# Targets /mnt/scrape-data (Oracle scrape-data workspace) with wc-cycle-cleanup.sh.
# Runs wc-cycle-cleanup.sh --apply --keep=48, alerts at > 90% disk.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WC_CLEANUP="$REPO_ROOT/scripts/wc-cycle-cleanup.sh"

SCRAPE_WORKSPACE="/mnt/scrape-data"

EVIDENCE_DIR="$REPO_ROOT/BUY-57358-evidence"
REPORT_PATH="$EVIDENCE_DIR/apply-report.json"
LOG_PATH="$EVIDENCE_DIR/apply-log.jsonl"

mkdir -p "$EVIDENCE_DIR"

RUN_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

disk_used_pct() { df -Pk / | awk 'NR==2 {gsub("%","",$5); print $5}'; }
log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*"; }

log "BUY-57358: Oracle scrape-data WC cycle cleanup starting"
log "SCRAPE_WORKSPACE=$SCRAPE_WORKSPACE WC_CLEANUP=$WC_CLEANUP"

disk_pct_before=$(disk_used_pct)
KEEP_HOURS=48
ALERT_PCT=90

log "Disk before: ${disk_pct_before}% keep_hours=${KEEP_HOURS} alert_pct=${ALERT_PCT}"

if [[ ! -x "$WC_CLEANUP" ]]; then
  log "ERROR: wc-cycle-cleanup.sh not found or not executable at $WC_CLEANUP"
  exit 1
fi

if [[ ! -d "$SCRAPE_WORKSPACE" ]]; then
  log "ERROR: scrape workspace $SCRAPE_WORKSPACE does not exist"
  exit 1
fi

inner_exit=0
bash "$WC_CLEANUP" \
  --apply \
  --keep="$KEEP_HOURS" \
  --alert-pct="$ALERT_PCT" \
  --workspace-dir="$SCRAPE_WORKSPACE" \
  --log-path="$LOG_PATH" \
  --report-path="$REPORT_PATH" || inner_exit=$?

disk_pct_after=$(disk_used_pct)
log "Disk after: ${disk_pct_after}%"
log "Report: $REPORT_PATH"

df -h /

if [ "$inner_exit" -ne 0 ] && [ "$inner_exit" -ne 10 ]; then
  log "WARNING: wc-cycle-cleanup.sh exited with $inner_exit"
  exit "$inner_exit"
fi

log "BUY-57358: completed. inner_exit=$inner_exit disk_before=${disk_pct_before}% disk_after=${disk_pct_after}%"
exit $inner_exit
