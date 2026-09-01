#!/bin/bash
# BUY-30620 Crate deep page lane keep-alive + ingest hook (BUY-33177)
# BUY-74212: BrightData env vars passed to lane process (residential zone + SB fallback)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="/paperclip/instances/default/workspaces/3ec8f6dd-1735-4479-9825-a2c42edac34c"
LOG="$ROOT/logs/buy30620_crate.log"
PIDFILE="$ROOT/data/.buy30620-crate-lane.pid"

# BrightData credentials — must be passed to lane node process
export BRIGHTDATA_CUSTOMER_ID=hl_3ab737be
export BRIGHTDATA_ZONE=residential
export BRIGHTDATA_PASSWORD=noo1so2vw1f8

exec > >(tee -a "$LOG") 2>&1
echo "[$(date -Iseconds)] crate keep-alive starting"

ingest_cycle() {
  # Process any cycle-*.ndjson under data/buy30620-crate that lacks a DB ingest marker.
  cd "$ROOT" || return
  find data/buy30620-crate -name "cycle-*.ndjson" -mmin +5 | \
    sort -t- -k2 -r | \
    while read -r f; do
      marker="${f}.ingested.json"
      if [ -f "$marker" ]; then
        if python3 -c "import json,sys; d=json.load(open('$marker')); sys.exit(0 if (d.get('ingest') or d.get('ingestedBy')) else 1)" 2>/dev/null; then
          continue  # already DB-ingested
        fi
      fi
      python3 scripts/ingest_buy30620_lanes.py --file "$f" \
        --no-require-r2 --min-age-sec 0 \
        >> "$ROOT/logs/buy30620_crate_ingest.log" 2>&1
    done
}

while true; do
  if [ -f "$PIDFILE" ]; then
    PID=$(cat "$PIDFILE")
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
      echo "[$(date -Iseconds)] crate already running PID=$PID"
    else
      echo "[$(date -Iseconds)] crate not running, launching with BrightData env"
      node "$SCRIPT_DIR/buy30620-crate-deep-page-lane.mjs" &
      LANE_PID=$!
      echo $LANE_PID > "$PIDFILE"
      wait "$LANE_PID"
      echo "[$(date -Iseconds)] crate lane exited; running ingest hook"
      ingest_cycle
    fi
  else
    echo "[$(date -Iseconds)] first launch crate with BrightData env"
    node "$SCRIPT_DIR/buy30620-crate-deep-page-lane.mjs" &
    LANE_PID=$!
    echo $LANE_PID > "$PIDFILE"
    wait "$LANE_PID"
    echo "[$(date -Iseconds)] crate lane exited; running ingest hook"
    ingest_cycle
  fi
  sleep 30
done
