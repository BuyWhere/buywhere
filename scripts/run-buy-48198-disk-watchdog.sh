#!/usr/bin/env bash
# BUY-48198 direct disk watchdog wrapper.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

export DISK_STATE_FILE="${DISK_STATE_FILE:-/tmp/buy-48198-disk-state.json}"
export DISK_EXECUTION_ISSUE="${DISK_EXECUTION_ISSUE:-${1:-BUY-48198}}"
export DISK_ROUTINE_IDENTIFIER="${DISK_ROUTINE_IDENTIFIER:-BUY-48198}"
export DISK_FILESYSTEM_LABEL="${DISK_FILESYSTEM_LABEL:-/dev/vda1}"
export DISK_MOUNT_PATH="${DISK_MOUNT_PATH:-/}"
export DISK_WARN_BYTES="${DISK_WARN_BYTES:-$((20 * 1024 * 1024 * 1024))}"

if [[ -z "${DISK_SNAPSHOT_DIR:-}" ]]; then
  timestamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
  export DISK_SNAPSHOT_DIR="$REPO_ROOT/data/${DISK_EXECUTION_ISSUE,,}-disk-monitor-${timestamp}"
fi

cd "$REPO_ROOT"
exec node scripts/buy-38913-disk-space-watchdog.cjs
