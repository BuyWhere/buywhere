#!/usr/bin/env bash
# DEPRECATED by BUY-57327. Use run-buy-57311-worker-wc-cycle-cleanup.sh instead.
set -euo pipefail

# BUY-48198 Disk Space Watchdog — runs every 5 min via cron
# Monitors /dev/vda1 free space:
#   < 5GB  → critical Paperclip incident
#   < 20GB → Paperclip warning incident
#   >=20GB → OK

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WATCHDOG_DIR="$REPO_ROOT/BUY-57188-evidence"
mkdir -p "$WATCHDOG_DIR"
# Thresholds in GB
CRITICAL_THRESHOLD_GB=5
WARN_THRESHOLD_GB=20

# Get free space on /dev/vda1 in KB
FREE_KB=$(df /dev/vda1 2>/dev/null | awk 'NR==2 {print $4}') || FREE_KB=$(df / | awk 'NR==2 {print $4}')
FREE_GB=$(( FREE_KB / 1024 / 1024 ))
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
REPORT_FILE="$WATCHDOG_DIR/report-${TIMESTAMP}.txt"

echo "[$TIMESTAMP] Disk Space Watchdog Report" > "$REPORT_FILE"
echo "  Device: /dev/vda1" >> "$REPORT_FILE"
echo "  Free:   ${FREE_GB}GB" >> "$REPORT_FILE"
echo "  Warn:   < ${WARN_THRESHOLD_GB}GB" >> "$REPORT_FILE"
echo "  Crit:   < ${CRITICAL_THRESHOLD_GB}GB" >> "$REPORT_FILE"

if [ "$FREE_GB" -lt "$CRITICAL_THRESHOLD_GB" ]; then
  SEVERITY="critical"
  MESSAGE="CRITICAL: Disk space at ${FREE_GB}GB — below ${CRITICAL_THRESHOLD_GB}GB threshold"
  echo "  Status: CRITICAL" >> "$REPORT_FILE"
elif [ "$FREE_GB" -lt "$WARN_THRESHOLD_GB" ]; then
  SEVERITY="warning"
  MESSAGE="WARNING: Disk space at ${FREE_GB}GB — below ${WARN_THRESHOLD_GB}GB threshold"
  echo "  Status: WARNING" >> "$REPORT_FILE"
else
  SEVERITY="ok"
  MESSAGE="OK: Disk space at ${FREE_GB}GB"
  echo "  Status: OK" >> "$REPORT_FILE"
fi

echo "" >> "$REPORT_FILE"
echo "$MESSAGE"
# Create Paperclip incident if critical or warning
if [ "$SEVERITY" = "critical" ] || [ "$SEVERITY" = "warning" ]; then
  # Determine the target issue (parent issue for the disk space incident)
  # BUY-57188 is the watchdog itself; we create a child incident under it
  PAPERCLIP_API_KEY="${PAPERCLIP_API_KEY:-}"
  PAPERCLIP_API_URL="${PAPERCLIP_API_URL:-https://paperclip.richteo.com}"
  PAPERCLIP_COMPANY_ID="${PAPERCLIP_COMPANY_ID:-177bc805-e3c8-4336-84cb-8e1e482d5a17}"
  PARENT_ISSUE_ID="${PAPERCLIP_TASK_ID:-}"

  if [ -n "$PAPERCLIP_API_KEY" ] && [ -n "$PARENT_ISSUE_ID" ]; then
    echo "  Creating Paperclip incident..."
    INCIDENT_TITLE="Disk Space ${SEVERITY}: ${FREE_GB}GB free on /dev/vda1"
    
    INCIDENT_RESPONSE=$(curl -s -X POST \
      "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/issues" \
      -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
      -H "Content-Type: application/json" \
      -d "{
        \"title\": \"$INCIDENT_TITLE\",
        \"description\": \"$MESSAGE. Details in attached report.\",
        \"status\": \"in_progress\",
        \"priority\": \"critical\",
        \"assigneeAgentId\": \"19dcd635-1d2b-4e41-9950-5865876e12b2\",
        \"parentId\": \"$PARENT_ISSUE_ID\",
        \"projectId\": \"e61bbe4e-c203-446d-ba8d-4cbf612804e3\"
      }" 2>&1)
    
    echo "  Incident response: $INCIDENT_RESPONSE" >> "$REPORT_FILE"
    echo "  Created incident: $INCIDENT_TITLE" 
  else
    echo "  [DRY-RUN] Would create incident: $MESSAGE" 
    echo "  [DRY-RUN] Would create incident: $MESSAGE" >> "$REPORT_FILE"
  fi
fi

echo "Report saved: $REPORT_FILE"
