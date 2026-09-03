#!/usr/bin/env bash
# setup-buy-57740-worker-node-artifact-cleanup.sh — BUY-57740
# Installs the recurring worker node WC cycle artifact cleanup cron job.
# Replaces all stale BUY-5xxxx WC cycle cleanup cron entries with a single
# consolidated entry for BUY-57740.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNNER="$SCRIPT_DIR/run-buy-57740-worker-wc-cycle-cleanup.sh"
LOG_FILE="$REPO_ROOT/logs/buy-57740-worker-node-artifact-cleanup.log"
MARKER="BUY-57740: Worker node WC cycle artifact cleanup — every 6 hours"
CRON_JOB="0 */6 * * * cd $REPO_ROOT && bash $RUNNER >> $LOG_FILE 2>&1 # $MARKER"

mkdir -p "$REPO_ROOT/logs"

# Remove ALL stale worker-node-artifact-cleanup and wc-cycle-cleanup cron entries
# from previous issues (BUY-57311, BUY-57358, BUY-57631, BUY-57654, BUY-57667,
# BUY-57669, BUY-57675, BUY-57677, etc.) to avoid duplicate runs.
CRONTAB="$(crontab -l 2>/dev/null || true)"
CLEANED="$(printf '%s\n' "$CRONTAB" | grep -Ev '(run-buy-[0-9]+-(worker-node-disk-space-enforcement|worker-wc-cycle-cleanup|worker-node-artifact-cleanup)\.sh|Worker node.*artifact cleanup|Worker node.*disk-space enforcement|Worker node.*WC cycle|WC cycle artifact cleanup)' || true)"

printf '%s\n%s\n' "$CLEANED" "$CRON_JOB" | crontab -

COUNT="$(crontab -l | grep -Ec 'BUY-57740.*WC cycle' || true)"
if [[ "$COUNT" -eq 1 ]]; then
  echo "Verified: crontab contains exactly 1 WC cycle cleanup entry (BUY-57740)"
else
  echo "Error: expected 1 WC cycle cleanup entry, found $COUNT" >&2
  exit 1
fi

echo "BUY-57740 cron installed. Runner: $RUNNER"
echo "Stale WC cycle cleanup cron entries from previous issues removed."

# Run initial cleanup
echo ""
echo "Running initial WC cycle cleanup..."
bash "$RUNNER"
echo ""
echo "Setup complete."
