#!/usr/bin/env bash
# run-buy-51074-crew-wc-rest-keep-alive-cron.sh — Cron wrapper for BUY-51074
# Crew REST sub-lane keep-alive: every 5 min, checks for a live worker and
# re-spawns one with --duration-sec=240 if dead. The heartbeat cgroup kill
# stops the lane between heartbeats; this keeps the sub-lane alive.
#
# BUY-51074 / BUY-31142
set -euo pipefail

# Source Paperclip API credentials (PAPERCLIP_API_KEY etc.)
ENV_FILE="/home/paperclip/.config/paperclip/agent.env"
if [[ -f "$ENV_FILE" ]]; then
  source "$ENV_FILE"
else
  echo "WARNING: $ENV_FILE not found" >&2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Cron does not inherit the harness shell env. Read the COMMITTED .env file
# via git show so redacted local modifications don't break the lane.
set -a
COMMITSHA=$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || true)
LANE_ENV="$REPO_ROOT/data/.env.buy31015-lane"
if [ -n "$COMMITSHA" ] && git -C "$REPO_ROOT" show "$COMMITSHA:data/.env.buy31015-lane" >/dev/null 2>&1; then
  . <(git -C "$REPO_ROOT" show "$COMMITSHA:data/.env.buy31015-lane")
elif [ -f "$LANE_ENV" ] && [ -s "$LANE_ENV" ]; then
  . "$LANE_ENV"
fi
set +a

# Daemon's data directory is the authoritative liveness state location.
# Both the background daemon and this cron guard must write to the same place
# to avoid split-brain.
DAEMON_DATA_DIR="/home/paperclip/buywhere-api/data"

# Invoke the keep-alive script in tick (--once) mode so each cron fire does a
# single check-and-respawn rather than entering the daemon's loop.
export WC_LANE_STATE_DIR="$DAEMON_DATA_DIR"
bash "$REPO_ROOT/scripts/buy31142-crew-wc-rest-keep-alive.sh"
