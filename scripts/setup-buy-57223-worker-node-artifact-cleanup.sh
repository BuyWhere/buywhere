#!/usr/bin/env bash
# setup-buy-57223-worker-node-artifact-cleanup.sh — BUY-57223
# Installs the recurring worker node WC cycle artifact cleanup cron job.
# Replaces all stale BUY-5xxxx WC cycle cleanup cron entries with a single
# consolidated entry for BUY-57223.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNNER="$SCRIPT_DIR/run-buy-57223-worker-wc-cycle-cleanup.sh"
LOG_FILE="$REPO_ROOT/logs/buy-57223-worker-node-artifact-cleanup.log"
MARKER="BUY-57223: Worker node WC cycle artifact cleanup (Oracle workspace) — every 6 hours"
CRON_JOB="0 */6 * * * cd $REPO_ROOT && bash $RUNNER >> $LOG_FILE 2>&1 # $MARKER"

mkdir -p "$REPO_ROOT/logs"

# Remove ALL stale worker-node-artifact-cleanup and wc-cycle-cleanup cron entries
# from previous issues (BUY-55411, BUY-55437, BUY-55448, BUY-56090, BUY-56542,
# BUY-56941, etc.) to avoid duplicate runs.
CRONTAB="$(crontab -l 2>/dev/null || true)"
CLEANED="$(printf '%s\n' "$CRONTAB" | grep -Ev '(run-buy-[0-9]+-(worker-node-disk-space-enforcement|worker-wc-cycle-cleanup|worker-node-artifact-cleanup)\.sh|Worker node.*artifact cleanup|Worker node.*disk-space enforcement|Worker node.*WC cycle|WC cycle artifact cleanup)' || true)"

printf '%s\n%s\n' "$CLEANED" "$CRON_JOB" | crontab -

COUNT="$(crontab -l | grep -Ec 'BUY-57223.*WC cycle' || true)"
if [[ "$COUNT" -eq 1 ]]; then
  echo "Verified: crontab contains exactly 1 WC cycle cleanup entry (BUY-57223)"
else
  echo "Error: expected 1 WC cycle cleanup entry, found $COUNT" >&2
  exit 1
fi

echo "BUY-57223 cron installed. Runner: $RUNNER"
echo "Stale WC cycle cleanup cron entries from previous issues removed."

# Run initial cleanup
echo ""
echo "Running initial WC cycle cleanup..."
bash "$RUNNER"
echo ""
echo "Setup complete."
