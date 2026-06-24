#!/usr/bin/env python3
"""Carousell SG Scraper Daemon Monitor - BUY-55388"""
import argparse, json, os, subprocess, sys, time
from datetime import datetime, timezone
from pathlib import Path

# Paths
WORKTREE_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = WORKTREE_ROOT / "data" / "carousell-sg"
PID_FILE = OUTPUT_DIR / "scraper.pid"
LOG_FILE = OUTPUT_DIR / "scraper.log"
STATUS_FILE = OUTPUT_DIR / "monitor-status.json"
RESTART_COUNTER = OUTPUT_DIR / "restart-count.json"

REFRESH_INTERVAL = 600
STALE_THRESHOLD = REFRESH_INTERVAL * 2
CRITICAL_DEAD_TIME = 300
WARN_RESTARTS_PER_HOUR = 3

def log(msg):
    print(f"[{datetime.now(timezone.utc).isoformat()}] {msg}")

def check_alive():
    if not PID_FILE.exists():
        return None
    try:
        pid = int(PID_FILE.read_text().strip())
        subprocess.run(["kill", "-0", str(pid)], check=True, capture_output=True)
        return pid
    except:
        return None

def get_jsonl_age():
    files = list(OUTPUT_DIR.glob("products_*.jsonl"))
    if not files:
        return None
    newest = max(f.stat().st_mtime for f in files)
    return time.time() - newest

def get_restart_count():
    try:
        data = json.loads(RESTART_COUNTER.read_text())
    except:
        data = {"count": 0, "hour_start": time.time()}
    now = time.time()
    if now - data["hour_start"] > 3600:
        data = {"count": 0, "hour_start": now}
    return data["count"]

def increment_restart():
    try:
        data = json.loads(RESTART_COUNTER.read_text())
    except:
        data = {"count": 0, "hour_start": time.time()}
    data["count"] += 1
    RESTART_COUNTER.write_text(json.dumps(data))

def write_status(healthy, message, restarted=False):
    status = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "healthy": healthy,
        "message": message,
        "restarted": restarted,
        "pid": check_alive(),
        "jsonl_age_seconds": get_jsonl_age()
    }
    STATUS_FILE.write_text(json.dumps(status, indent=2))
    return status

def main():
    alive_pid = check_alive()
    jsonl_age = get_jsonl_age()
    restarts = get_restart_count()
    
    if alive_pid:
        if jsonl_age and jsonl_age > STALE_THRESHOLD:
            log(f"WARN: JSONL files stale ({jsonl_age/60:.1f}m)")
            status = write_status(False, f"JSONL stale: {jsonl_age/60:.1f}m")
        else:
            log(f"OK: Scraper alive (PID {alive_pid}), JSONL age: {jsonl_age/60:.1f}m" if jsonl_age else "OK: Scraper alive")
            status = write_status(True, "Healthy")
        sys.exit(0)
    
    # Scraper dead
    log(f"WARN: Scraper dead (PID file: {PID_FILE})")
    if restarts >= WARN_RESTARTS_PER_HOUR:
        log(f"CRITICAL: High restart rate ({restarts}/hour)")
        write_status(False, f"High restart rate: {restarts}/hour", True)
        sys.exit(2)
    
    # Restart
    log("Restarting scraper...")
    increment_restart()
    cmd = ["python3", "-m", "scrapers.carousell_sg", "--scrape-only", "--continuous", "--refresh-interval", "14400"]
    subprocess.Popen(cmd, cwd=WORKTREE_ROOT, stdout=open(LOG_FILE, "a"), stderr=subprocess.STDOUT)
    time.sleep(1)
    new_pid = check_alive()
    write_status(True, "Restarted", True)
    log(f"Started with PID {new_pid}")
    sys.exit(0 if new_pid else 1)

if __name__ == "__main__":
    main()
