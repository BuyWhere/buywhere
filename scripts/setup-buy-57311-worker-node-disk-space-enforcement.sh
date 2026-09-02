#!/usr/bin/env bash
# setup-buy-57311-worker-node-disk-space-enforcement.sh — BUY-57311 (stable, idempotent)
#
# Consolidates all WC cycle cleanup cron entries into a SINGLE canonical entry.
# Uses a shared marker "wc-cycle-cleanup-cron" to deduplicate.
# Removes all older per-issue number fragments from paths as well.
#
# Replaces: BUY-55411, BUY-55437, BUY-55448, BUY-56542, BUY-56941,
#           BUY-57107, BUY-57166, BUY-57262
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RUNNER="$SCRIPT_DIR/run-buy-57311-worker-wc-cycle-cleanup.sh"
LOG_FILE="$REPO_ROOT/logs/buy-57311-wc-cycle-cleanup.log"

# Shared marker — singles out the canonical WC cycle cleanup cron entry.
# Must match the comment appended to the cron line.
MARKER="wc-cycle-cleanup-cron"

# Old issue numbers to remove — these appear in paths like
# run-buy-55411-... and buy-55411-... so we match the numeric part.
OLD_ISSUE_NUMS=(
  "55411"
  "55437"
  "55448"
  "56542"
  "56941"
  "57107"
  "57166"
  "57262"
  "57311"
)

NEW_CRON="0 */6 * * * cd $REPO_ROOT && bash $RUNNER >> $LOG_FILE 2>&1 # BUY-57311: WC cycle artifact cleanup -- wc-cycle-cleanup-cron"

mkdir -p "$REPO_ROOT/logs"

# Remove ALL old entries: both the shared marker and each old issue number.
CRONTAB="$(crontab -l 2>/dev/null || true)"
CLEANED="$CRONTAB"

# Remove by marker first (exact match on the comment suffix)
CLEANED="$(printf '%s\n' "$CLEANED" | grep -v "$MARKER" || true)"

# Remove by numeric issue number (catches path fragments like run-buy-55411-)
for num in "${OLD_ISSUE_NUMS[@]}"; do
  CLEANED="$(printf '%s\n' "$CLEANED" | grep -v "$num" || true)"
done

# Add the new canonical entry
printf '%s\n%s\n' "$CLEANED" "$NEW_CRON" | crontab -

# Verify exactly one canonical entry remains
COUNT="$(crontab -l | grep -c "$MARKER" || true)"
if [[ "$COUNT" -eq 1 ]]; then
  echo "Verified: crontab contains exactly 1 wc-cycle-cleanup-cron entry"
else
  echo "Error: expected 1 wc-cycle-cleanup-cron entry, found $COUNT" >&2
  exit 1
fi

echo "Consolidated WC cycle cleanup cron installed (idempotent). Runner: $RUNNER"
echo ""
echo "Removed old fragmented entries matching issue numbers:"
for num in "${OLD_ISSUE_NUMS[@]}"; do
  echo "  - $num"
done
echo ""
echo "To verify: crontab -l | grep 'wc-cycle-cleanup-cron'"
