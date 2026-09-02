#!/usr/bin/env bash
# BUY-70782 — Oracle dead→ok auto-repair handoff.
# Delegates to the BUY-70926 consumer (same queue; adapter map + >7d death-monitor live there).
set -uo pipefail
ROOT="/paperclip/instances/default/workspaces/3ec8f6dd-1735-4479-9825-a2c42edac34c"
exec "$ROOT/scripts/cron/buy70926-reingest-on-probe-flip.sh" "$@"
