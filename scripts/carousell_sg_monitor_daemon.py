#!/usr/bin/env python3
"""Carousell SG Scraper Monitor Daemon

Runs continuously in background, checking scraper health every
REFRESH_INTERVAL_SECONDS and restarting if dead.
"""
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

WORKTREE_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = WORKTREE_ROOT / "data" / "carousell-sg"
PID_FILE = OUTPUT_DIR / "scraper.pid"
LOG_FILE = OUTPUT_DIR / "monitor.log"
STATUS_FILE = OUTPUT_DIR / "monitor-status.json"
RESTART_COUNTER = OUTPUT_DIR / "restart-count.json"
MONITOR_PID_FILE = OUTPUT_DIR / "monitor.pid"

REFRESH_INTERVAL = 600  # 10 minutes
STALE_THRESHOLD = REFRESH_INTERVAL * 2
WARN_RESTARTS_PER_HOUR = 3


def log(msg):
    ts = datetime.now(timezone.utc).isoformat()
    line = f"[{ts}] {msg}"
    print(line)
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")


def check_alive():
    if not PID_FILE.exists():
        return None
    try:
        pid = int(PID_FILE.read_text().strip())
        subprocess.run(["kill", "-0", str(pid)], check=True, capture_output=True)
        return pid
    except Exception:
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
    except Exception:
        data = {"count": 0, "hour_start": time.time()}
    now = time.time()
    if now - data.get("hour_start", 0) > 3600:
        data = {"count": 0, "hour_start": now}
    return data.get("count", 0)


def increment_restart():
    try:
        data = json.loads(RESTART_COUNTER.read_text())
    except Exception:
        data = {"count": 0, "hour_start": time.time()}
    data["count"] = data.get("count", 0) + 1
    RESTART_COUNTER.write_text(json.dumps(data))


def write_status(healthy, message, restarted=False, pid=None, jsonl_age=None, restarts=0):
    status = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "healthy": healthy,
        "message": message,
        "restarted": restarted,
        "pid": pid,
        "jsonl_age_seconds": jsonl_age,
        "restart_count_hour": restarts,
        "status": "healthy" if healthy else "down" if not restarted else "restarting",
    }
    STATUS_FILE.write_text(json.dumps(status, indent=2))
    return status


def restart_scraper():
    log("Restarting scraper...")
    increment_restart()
    
    # Clean up stale PID file
    if PID_FILE.exists():
        try:
            old_pid = int(PID_FILE.read_text().strip())
            try:
                subprocess.run(["kill", "-0", str(old_pid)], check=True, capture_output=True)
                log(f"Old scraper still alive (PID {old_pid}), killing it first")
                subprocess.run(["kill", "-9", str(old_pid)], check=False, capture_output=True)
            except Exception:
                pass
        except Exception:
            pass
        PID_FILE.unlink(missing_ok=True)
    
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    
    cmd = [
        sys.executable, "-m", "scrapers.carousell_sg",
        "--scrape-only", "--continuous",
        "--refresh-interval", "14400",
        "--products-per-category", "5000",
    ]
    
    p = subprocess.Popen(
        cmd,
        cwd=str(WORKTREE_ROOT),
        env=env,
        stdout=open(OUTPUT_DIR / "scraper.log", "a"),
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    
    time.sleep(2)
    new_pid = check_alive()
    if new_pid:
        log(f"Scraper restarted with PID {new_pid}")
        return new_pid
    else:
        log("Failed to restart scraper")
        return None



import urllib.request
import urllib.error

ALERT_WEBHOOK_URL = os.environ.get("ALERT_WEBHOOK_URL", "")

def _send_alert(subject: str, message: str):
    """Send alert via webhook if configured."""
    if not ALERT_WEBHOOK_URL:
        return
    payload = json.dumps({"subject": subject, "message": message, "source": "carousell-sg-monitor"}).encode()
    try:
        req = urllib.request.Request(ALERT_WEBHOOK_URL, data=payload, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=10)
    except Exception as exc:
        log(f"Failed to send alert: {exc}")

def alert_if_needed(restarts: int, situation: str):
    """Send alert when restart rate is high or scraper is unhealthy."""
    if restarts >= WARN_RESTARTS_PER_HOUR:
        _send_alert("Carousell SG Scraper: High Restart Rate", f"{restarts} restarts in the last hour. Situation: {situation}")
    elif situation in ("dead", "stale"):
        _send_alert("Carousell SG Scraper: Unhealthy", f"Scraper situation: {situation}")
def main_loop():
    log("Monitor daemon starting")
    
    while True:
        alive_pid = check_alive()
        jsonl_age = get_jsonl_age()
        restarts = get_restart_count()
        
        if alive_pid:
            if jsonl_age and jsonl_age > STALE_THRESHOLD:
                log(f"WARN: JSONL files stale ({jsonl_age/60:.1f}m), scraper alive but not producing data")
                write_status(False, f"JSONL stale: {jsonl_age/60:.1f}m", pid=alive_pid, jsonl_age=jsonl_age, restarts=restarts)
                alert_if_needed(restarts, "stale")
            else:
                age_str = f"{jsonl_age/60:.1f}m" if jsonl_age else "N/A"
                log(f"OK: Scraper alive (PID {alive_pid}), JSONL age: {age_str}")
                write_status(True, "Healthy", pid=alive_pid, jsonl_age=jsonl_age, restarts=restarts)
        else:
            log("WARN: Scraper dead — no running process found")
            if restarts >= WARN_RESTARTS_PER_HOUR:
                log(f"CRITICAL: High restart rate ({restarts}/hour) — not restarting")
                write_status(False, f"High restart rate: {restarts}/hour", restarts=restarts)
                alert_if_needed(restarts, f"high_restart_rate_{restarts}/hour")
            else:
                new_pid = restart_scraper()
                if new_pid:
                    write_status(True, "Scraper restarted by monitor", restarted=True, pid=new_pid, restarts=get_restart_count())
                else:
                    write_status(False, "Restart failed", restarts=restarts)
                    alert_if_needed(restarts, "restart_failed")
        
        log(f"Sleeping {REFRESH_INTERVAL}s until next check...")
        time.sleep(REFRESH_INTERVAL)


if __name__ == "__main__":
    # Write monitor PID file
    MONITOR_PID_FILE.write_text(str(os.getpid()))
    try:
        main_loop()
    finally:
        MONITOR_PID_FILE.unlink(missing_ok=True)
