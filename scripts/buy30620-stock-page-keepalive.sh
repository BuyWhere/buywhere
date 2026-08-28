#!/bin/bash
# BUY-30620 Stock page lane keep-alive + ingest hook (BUY-33177)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="/paperclip/instances/default/workspaces/3ec8f6dd-1735-4479-9825-a2c42edac34c"
LOG="$ROOT/logs/buy30620_stock.log"
PIDFILE="$ROOT/data/.buy30620-stock-lane.pid"

exec > >(tee -a "$LOG") 2>&1
echo "[$(date -Iseconds)] stock keep-alive starting"

ingest_cycle() {
  # BUY-76308: --file with explicit paths bypasses lane-detection path ambiguity.
  cd "$ROOT" || return
  find data/buy30620-stock -name "cycle-*.ndjson" -mmin +5 | \
    sort -t- -k2 -r | \
    while read -r f; do
      marker="${f}.ingested.json"
      if [ -f "$marker" ]; then
        if python3 -c "import json,sys; d=json.load(open('$marker')); sys.exit(0 if (d.get('ingest') or d.get('ingestedBy')) else 1)" 2>/dev/null; then
          continue
        fi
      fi
      python3 scripts/ingest_buy30620_lanes.py --file "$f" \
        --no-require-r2 --min-age-sec 0 \
        >> "$ROOT/logs/buy30620_stock_ingest.log" 2>&1
    done
}

while true; do
  if [ -f "$PIDFILE" ]; then
    PID=$(cat "$PIDFILE")
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
      echo "[$(date -Iseconds)] stock already running PID=$PID"
    else
      echo "[$(date -Iseconds)] stock not running, launching"
      node "$SCRIPT_DIR/buy30620-stock-page-lane.mjs" &
      LANE_PID=$!
      echo $LANE_PID > "$PIDFILE"
      wait "$LANE_PID"
      echo "[$(date -Iseconds)] stock lane exited; running ingest hook"
      ingest_cycle
    fi
  else
    echo "[$(date -Iseconds)] first launch stock"
    node "$SCRIPT_DIR/buy30620-stock-page-lane.mjs" &
    LANE_PID=$!
    echo $LANE_PID > "$PIDFILE"
    wait "$LANE_PID"
    echo "[$(date -Iseconds)] stock lane exited; running ingest hook"
    ingest_cycle
  fi
  sleep 30
done
