#!/bin/bash
# aeo-merge-gate.sh — refuse to push to main without a recent §7 snapshot
#
# Per BUY-75420 (4seen item 1): Reach's merge helper must refuse to push to main
# unless a `aeo-publish-verify.sh snapshot` has been run within the last 2 hours.
# This prevents pushing without pre-deploy evidence.
#
# Usage:
#   bash scripts/aeo-merge-gate.sh check    — exit 0 if snapshot is fresh, 1 otherwise
#   bash scripts/aeo-merge-gate.sh enforce   — echo PASS/FAIL and exit accordingly
#
# Integrate into the agent merge workflow: call `enforce` before `git push origin main`.
# If the gate fails, it prints the fix and exits non-zero.

set -uo pipefail

VERIFY_DIR="${AEO_VERIFY_DIR:-/var/lib/aeo-verify}"
SNAPSHOT_FILE="$VERIFY_DIR/before.counts"
MAX_AGE_SECONDS=7200  # 2 hours

case "${1:-check}" in
check)
  if [ ! -f "$SNAPSHOT_FILE" ]; then
    echo "FAIL: No snapshot found at $SNAPSHOT_FILE"
    echo "Run 'bash /usr/local/sbin/aeo-publish-verify.sh snapshot' before pushing to main."
    exit 1
  fi
  SNAPSHOT_AGE=$(($(date +%s) - $(stat -c %Y "$SNAPSHOT_FILE" 2>/dev/null || stat -f %m "$SNAPSHOT_FILE" 2>/dev/null)))
  if [ "$SNAPSHOT_AGE" -gt "$MAX_AGE_SECONDS" ]; then
    echo "FAIL: Snapshot is $((SNAPSHOT_AGE / 60)) minutes old (>${MAX_AGE_SECONDS}s threshold)"
    echo "Snapshot timestamp: $(stat -c %y "$SNAPSHOT_FILE" 2>/dev/null || stat -f %Sm "$SNAPSHOT_FILE" 2>/dev/null)"
    echo "Run a fresh 'bash /usr/local/sbin/aeo-publish-verify.sh snapshot' before pushing to main."
    exit 1
  fi
  echo "PASS: Snapshot is $((SNAPSHOT_AGE / 60)) minutes old (within 2h limit)"
  exit 0
  ;;
enforce)
  result=$(bash "$0" check 2>&1)
  rc=$?
  echo "=== §7 merge gate ==="
  echo "$result"
  if [ $rc -eq 0 ]; then
    echo "MERGE GATE: PASS — proceed with push to main"
  else
    echo "MERGE GATE: FAIL — DO NOT PUSH TO MAIN until a fresh snapshot is taken"
  fi
  exit $rc
  ;;
*)
  echo "usage: bash $0 check|enforce"
  exit 2
  ;;
esac
