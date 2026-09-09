"""Monitoring endpoints for scraper daemons and background jobs."""
import json
import os
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/monitoring", tags=["monitoring"])

CAROUSSEL_DATA_DIR = Path("/home/paperclip/buywhere-api/data/carousell-sg")


def _read_json(path: Path) -> Optional[dict]:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except Exception:
        return None


@router.get("/carousell-sg")
async def carousell_sg_monitor():
    """Return live health status of the Carousell SG scraper daemon."""
    monitor_status = _read_json(CAROUSSEL_DATA_DIR / "monitor-status.json")
    scheduler_state = _read_json(CAROUSSEL_DATA_DIR / "scheduler_state.json")
    restart_count = _read_json(CAROUSSEL_DATA_DIR / "restart-count.json")

    # Check if monitor daemon PID is alive
    monitor_pid_file = CAROUSSEL_DATA_DIR / "monitor.pid"
    monitor_alive = False
    if monitor_pid_file.exists():
        try:
            pid = int(monitor_pid_file.read_text().strip())
            os.kill(pid, 0)
            monitor_alive = True
        except (OSError, ValueError):
            pass

    # Check if scheduler PID is alive
    scheduler_alive = False
    scheduler_pid_file = CAROUSSEL_DATA_DIR / "scheduler.pid"
    if scheduler_pid_file.exists():
        try:
            pid = int(scheduler_pid_file.read_text().strip())
            os.kill(pid, 0)
            scheduler_alive = True
        except (OSError, ValueError):
            pass

    return JSONResponse(content={
        "source": "carousell_sg",
        "monitored_at": datetime.now(timezone.utc).isoformat(),
        "monitor_daemon_alive": monitor_alive,
        "scheduler_alive": scheduler_alive,
        "latest_status": monitor_status,
        "scheduler_state": scheduler_state,
        "restart_count": restart_count,
        "data_dir": str(CAROUSSEL_DATA_DIR),
        "checks": {
            "monitor_pid_file_exists": monitor_pid_file.exists(),
            "scheduler_pid_file_exists": scheduler_pid_file.exists(),
            "monitor_log_file_exists": (CAROUSSEL_DATA_DIR / "monitor.log").exists(),
            "scraper_log_file_exists": (CAROUSSEL_DATA_DIR / "scraper.log").exists(),
            "status_file_exists": (CAROUSSEL_DATA_DIR / "monitor-status.json").exists(),
            "scheduler_state_file_exists": (CAROUSSEL_DATA_DIR / "scheduler_state.json").exists(),
        }
    })


@router.get("/carousell-sg/logs")
async def carousell_sg_logs(tail: int = 50):
    """Return the last N lines of the monitor log."""
    log_file = CAROUSSEL_DATA_DIR / "monitor.log"
    if not log_file.exists():
        return JSONResponse(content={"error": "monitor.log not found"}, status_code=404)
    lines = log_file.read_text().strip().splitlines()
    tail_lines = lines[-tail:] if tail < len(lines) else lines
    return JSONResponse(content={
        "source": "carousell_sg",
        "log_file": str(log_file),
        "total_lines": len(lines),
        "tail": tail,
        "lines": tail_lines,
    })
