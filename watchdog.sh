#!/bin/bash
# watchdog.sh — restart Next.js server if port 3006 is not responding
# Created: BUY-4671 Gate 5 resilience (HB25)
# Updated: BUY-9152 — point to .next-fresh (current build)

LOGFILE="/home/paperclip/buywhere-site/.next-deploy-server.log"
STANDALONE_DIR="/home/paperclip/buywhere-site/.next-fresh/standalone"

# Check if port 3006 is responding
if ! curl -sf -o /dev/null http://127.0.0.1:3006/ 2>/dev/null; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] WATCHDOG: port 3006 not responding — restarting Next.js server" >> "$LOGFILE"

  # Kill any stale next-server processes on port 3006
  lsof -ti:3006 2>/dev/null | xargs kill 2>/dev/null
  sleep 2

  # Start fresh with nohup
  cd "$STANDALONE_DIR" && nohup env PORT=3006 HOSTNAME=0.0.0.0 node server.js >> "$LOGFILE" 2>&1 &
  NEW_PID=$!
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] WATCHDOG: started new server PID $NEW_PID" >> "$LOGFILE"
else
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] WATCHDOG: OK (port 3006 responding)" >> "$LOGFILE"
fi
