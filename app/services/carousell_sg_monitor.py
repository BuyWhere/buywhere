"""Carousell SG scraper daemon monitoring service.

Monitors the health and status of the Carousell SG scraper daemon including:
- Process health checks (PID file and running process detection)
- Data file freshness monitoring (JSONL output files)
- Scheduler state inspection
- Resource utilization and performance metrics
- Alerting for failures and degraded states
"""
from __future__ import annotations

import json
import os
import sys
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from app.logging_centralized import get_logger

logger = get_logger("carousell-sg-monitor")

SOURCE = "carousell_sg"
WORKSPACE = Path("/home/paperclip/buywhere-api")
OUTPUT_DIR = WORKSPACE / "data" / "carousell-sg"
SCHEDULER_PID_FILE = OUTPUT_DIR / "scheduler.pid"
SCRAPER_PID_FILE = OUTPUT_DIR / "scraper.pid"
SCHEDULER_STATE_FILE = OUTPUT_DIR / "scheduler_state.json"
STATUS_FILE = OUTPUT_DIR / "monitor-status.json"
RESTART_COUNTER = OUTPUT_DIR / "restart-count.json"
SCHEDULER_SCRIPT = WORKSPACE / "scripts" / "scraper_scheduler.py"

REFRESH_INTERVAL_SECONDS = 600
STALE_THRESHOLD_SECONDS = REFRESH_INTERVAL_SECONDS * 2
CRITICAL_DEAD_TIME_SECONDS = 300
WARN_RESTARTS_PER_HOUR = 3


def _pid_alive(pid: int | None) -> bool:
    if pid is None:
        return False
    try:
        subprocess.run(["kill", "-0", str(pid)], check=True, capture_output=True)
        return True
    except Exception:
        return False


def _read_pid(path: Path) -> int | None:
    if not path.exists():
        return None
    try:
        return int(path.read_text().strip())
    except Exception:
        return None


@dataclass
class DaemonMonitorResult:
    """Result of a single daemon health check."""
    checked_at: datetime
    healthy: bool
    pid: Optional[int] = None
    scheduler_pid: Optional[int] = None
    jsonl_age_seconds: Optional[float] = None
    log_file_size_bytes: Optional[int] = None
    restart_count_hour: int = 0
    message: str = ""
    restarted: bool = False
    status: str = "unknown"
    elapsed_ms: float = 0.0
    scheduler_state: Optional[dict] = None
    last_error: Optional[str] = None


class CarousellSGDaemonMonitor:
    """Monitors the Carousell SG scraper daemon process and data outputs."""

    def __init__(self, output_dir: Path | str = OUTPUT_DIR):
        self.output_dir = Path(output_dir)
        self.source = SOURCE

    def _get_scheduler_state(self) -> Optional[dict]:
        if not SCHEDULER_STATE_FILE.exists():
            return None
        try:
            return json.loads(SCHEDULER_STATE_FILE.read_text())
        except Exception:
            return None

    def get_jsonl_age(self) -> Optional[float]:
        files = list(self.output_dir.glob("products_*.jsonl"))
        if not files:
            return None
        newest = max(f.stat().st_mtime for f in files)
        return time.time() - newest

    def get_log_file_size(self) -> Optional[int]:
        log_file = self.output_dir / "scraper.log"
        if not log_file.exists():
            return None
        try:
            return log_file.stat().st_size
        except Exception:
            return None

    def get_restart_count(self) -> int:
        try:
            data = json.loads(RESTART_COUNTER.read_text())
        except Exception:
            data = {"count": 0, "hour_start": time.time()}
        now = time.time()
        if now - data.get("hour_start", 0) > 3600:
            data = {"count": 0, "hour_start": now}
        return data.get("count", 0)

    def _write_status(self, result: DaemonMonitorResult) -> None:
        try:
            payload = {
                "checked_at": result.checked_at.isoformat(),
                "healthy": result.healthy,
                "message": result.message,
                "restarted": result.restarted,
                "pid": result.pid,
                "scheduler_pid": result.scheduler_pid,
                "jsonl_age_seconds": result.jsonl_age_seconds,
                "log_file_size_bytes": result.log_file_size_bytes,
                "restart_count_hour": result.restart_count_hour,
                "status": result.status,
                "elapsed_ms": result.elapsed_ms,
                "scheduler_state": result.scheduler_state,
                "last_error": result.last_error,
            }
            STATUS_FILE.write_text(json.dumps(payload, indent=2))
        except Exception as exc:
            logger.error("Failed to write monitor status file", extra={"error": str(exc)})

    def check(self) -> DaemonMonitorResult:
        start = time.perf_counter()
        now = datetime.now(timezone.utc)

        scheduler_pid = _read_pid(SCHEDULER_PID_FILE)
        scraper_pid = _read_pid(SCRAPER_PID_FILE)
        scheduler_alive = _pid_alive(scheduler_pid)
        scraper_alive = _pid_alive(scraper_pid)
        scheduler_state = self._get_scheduler_state()
        jsonl_age = self.get_jsonl_age()
        log_size = self.get_log_file_size()
        restarts = self.get_restart_count()

        if scheduler_alive:
            if jsonl_age is not None and jsonl_age > STALE_THRESHOLD_SECONDS:
                msg = f"Scheduler alive (PID {scheduler_pid}) but JSONL stale ({jsonl_age/60:.1f}m)"
                result = DaemonMonitorResult(
                    checked_at=now,
                    healthy=False,
                    pid=scraper_pid,
                    scheduler_pid=scheduler_pid,
                    jsonl_age_seconds=jsonl_age,
                    log_file_size_bytes=log_size,
                    restart_count_hour=restarts,
                    message=msg,
                    status="degraded",
                    scheduler_state=scheduler_state,
                )
                logger.warning(msg)
            else:
                age_msg = f", JSONL age: {jsonl_age/60:.1f}m" if jsonl_age else ""
                msg = f"Scheduler alive (PID {scheduler_pid}), scraper PID {scraper_pid}{age_msg}"
                result = DaemonMonitorResult(
                    checked_at=now,
                    healthy=True,
                    pid=scraper_pid,
                    scheduler_pid=scheduler_pid,
                    jsonl_age_seconds=jsonl_age,
                    log_file_size_bytes=log_size,
                    restart_count_hour=restarts,
                    message=msg,
                    status="healthy",
                    scheduler_state=scheduler_state,
                )
                logger.info(msg)
        elif scraper_alive:
            msg = f"Scheduler dead, scraper alive (PID {scraper_pid}) — unusual state"
            result = DaemonMonitorResult(
                checked_at=now,
                healthy=False,
                pid=scraper_pid,
                scheduler_pid=scheduler_pid,
                jsonl_age_seconds=jsonl_age,
                log_file_size_bytes=log_size,
                restart_count_hour=restarts,
                message=msg,
                status="degraded",
                scheduler_state=scheduler_state,
            )
            logger.warning(msg)
        else:
            msg = "Daemon dead (scheduler and scraper both down)"
            result = DaemonMonitorResult(
                checked_at=now,
                healthy=False,
                pid=None,
                scheduler_pid=scheduler_pid,
                jsonl_age_seconds=jsonl_age,
                log_file_size_bytes=log_size,
                restart_count_hour=restarts,
                message=msg,
                status="down",
                scheduler_state=scheduler_state,
            )
            logger.warning(msg)

        result.elapsed_ms = round((time.perf_counter() - start) * 1000, 2)
        self._write_status(result)
        return result

    def restart(self) -> DaemonMonitorResult:
        now = datetime.now(timezone.utc)
        restarts = self.get_restart_count()

        if restarts >= WARN_RESTARTS_PER_HOUR:
            msg = f"High restart rate ({restarts}/hour) — not restarting"
            result = DaemonMonitorResult(
                checked_at=now,
                healthy=False,
                restart_count_hour=restarts,
                message=msg,
                status="critical",
            )
            self._write_status(result)
            logger.critical(msg)
            return result

        logger.info("Restarting Carousell SG scraper daemon via scheduler")
        try:
            # Kill any stale scheduler or scraper processes that might have stale PID files
            for pid_file in [SCHEDULER_PID_FILE, SCRAPER_PID_FILE]:
                pid = _read_pid(pid_file)
                if pid and not _pid_alive(pid):
                    pid_file.unlink(missing_ok=True)

            # Start the scheduler in continuous mode
            cmd = [
                sys.executable, str(SCHEDULER_SCRIPT),
                "--continuous", "--platform", "carousell_sg",
            ]
            env = os.environ.copy()
            # Ensure SCRAPERAPI_KEY is in environment
            if not env.get("SCRAPERAPI_KEY"):
                env["SCRAPERAPI_KEY"] = "0832602ba87752788b2cd9ab6cef34df"

            subprocess.Popen(
                cmd,
                cwd=str(WORKSPACE),
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            time.sleep(2)

            new_scheduler_pid = _read_pid(SCHEDULER_PID_FILE)
            new_scraper_pid = _read_pid(SCRAPER_PID_FILE)
            scheduler_alive = _pid_alive(new_scheduler_pid)

            # Update restart counter
            try:
                data = json.loads(RESTART_COUNTER.read_text())
            except Exception:
                data = {"count": 0, "hour_start": time.time()}
            data["count"] = data.get("count", 0) + 1
            RESTART_COUNTER.write_text(json.dumps(data))

            new_restarts = self.get_restart_count()
            result = DaemonMonitorResult(
                checked_at=now,
                healthy=scheduler_alive,
                pid=new_scraper_pid,
                scheduler_pid=new_scheduler_pid,
                restart_count_hour=new_restarts,
                message="Daemon restarted via scheduler" if scheduler_alive else "Restart failed — scheduler did not start",
                restarted=True,
                status="restarting" if scheduler_alive else "failed",
                scheduler_state=self._get_scheduler_state(),
            )
            self._write_status(result)
            return result
        except Exception as exc:
            msg = f"Restart failed: {exc}"
            result = DaemonMonitorResult(
                checked_at=now,
                healthy=False,
                message=msg,
                status="error",
            )
            self._write_status(result)
            logger.error(msg)
            return result

    def to_dict(self, result: DaemonMonitorResult) -> dict[str, Any]:
        return {
            "checked_at": result.checked_at.isoformat(),
            "healthy": result.healthy,
            "pid": result.pid,
            "scheduler_pid": result.scheduler_pid,
            "jsonl_age_seconds": result.jsonl_age_seconds,
            "log_file_size_bytes": result.log_file_size_bytes,
            "restart_count_hour": result.restart_count_hour,
            "message": result.message,
            "restarted": result.restarted,
            "status": result.status,
            "elapsed_ms": result.elapsed_ms,
            "scheduler_state": result.scheduler_state,
            "last_error": result.last_error,
        }


# Singleton instance for fast reuse
_monitor_instance: Optional[CarousellSGDaemonMonitor] = None


def get_monitor() -> CarousellSGDaemonMonitor:
    global _monitor_instance
    if _monitor_instance is None:
        _monitor_instance = CarousellSGDaemonMonitor()
    return _monitor_instance
