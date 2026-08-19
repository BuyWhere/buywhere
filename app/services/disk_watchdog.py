"""Disk space watchdog that checks disk usage every 5 minutes and fires Sentry alerts / Paperclip incidents on threshold crossings."""
import asyncio
import os
import shutil
import time
from datetime import datetime, timezone
from typing import Optional

import httpx
import sentry_sdk

from app.logging_centralized import get_logger
from app.sentry import is_sentry_enabled

logger = get_logger("disk-watchdog")

INTERVAL_SECONDS = 300  # 5 minutes
WARN_FREE_GB = 20.0     # warn when free space falls below 20 GB
CRITICAL_FREE_GB = 5.0  # create Paperclip incident when free space falls below 5 GB
CHECK_PATH = "/"

PAPERCLIP_API_URL = os.environ.get("PAPERCLIP_API_URL")
PAPERCLIP_API_KEY = os.environ.get("PAPERCLIP_API_KEY")
PAPERCLIP_RUN_ID = os.environ.get("PAPERCLIP_RUN_ID")

_last_check_result: Optional[dict] = None
_last_warning_at: float = 0.0
_last_critical_at: float = 0.0
_paperclip_incident_created: bool = False


def _check_disk_now() -> dict:
    total, used, free = shutil.disk_usage(CHECK_PATH)
    pct = round(used / total * 100, 1)
    free_gb = free / (1 << 30)
    return {
        "total_bytes": total,
        "used_bytes": used,
        "available_bytes": free,
        "free_gb": round(free_gb, 2),
        "usage_percent": pct,
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }


def get_last_check() -> Optional[dict]:
    return _last_check_result


def _maybe_fire_sentry(result: dict, level: str, message: str) -> None:
    if not is_sentry_enabled():
        return
    with sentry_sdk.new_scope() as scope:
        scope.set_level(level)
        scope.set_tag("watchdog", "disk_space")
        scope.set_extra("disk_total_bytes", result["total_bytes"])
        scope.set_extra("disk_used_bytes", result["used_bytes"])
        scope.set_extra("disk_available_bytes", result["available_bytes"])
        scope.set_extra("disk_free_gb", result["free_gb"])
        scope.set_extra("disk_usage_percent", result["usage_percent"])
        sentry_sdk.capture_message(message, level=level)


async def _create_paperclip_incident(message: str) -> bool:
    if not PAPERCLIP_API_URL or not PAPERCLIP_API_KEY:
        logger.warning("Paperclip incident skipped: PAPERCLIP_API_URL or PAPERCLIP_API_KEY missing")
        return False

    headers = {
        "Authorization": f"Bearer {PAPERCLIP_API_KEY}",
        "Content-Type": "application/json",
    }
    if PAPERCLIP_RUN_ID:
        headers["X-Paperclip-Run-Id"] = PAPERCLIP_RUN_ID

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                f"{PAPERCLIP_API_URL.rstrip('/')}/api/issues",
                headers=headers,
                json={
                    "title": "Disk Space Critical",
                    "description": message,
                    "priority": "critical",
                },
            )
            if response.status_code < 400:
                data = response.json()
                logger.info(f"Paperclip incident created: {data.get('id', 'unknown')}")
                return True
            logger.warning(f"Paperclip incident creation failed: {response.status_code} {response.text[:200]}")
            return False
    except Exception:
        logger.exception("Paperclip incident creation failed")
        return False


async def _watchdog_loop() -> None:
    global _last_check_result, _last_warning_at, _last_critical_at, _paperclip_incident_created

    logger.info(f"Disk space watchdog started (interval={INTERVAL_SECONDS}s, warn={WARN_FREE_GB}GB, critical={CRITICAL_FREE_GB}GB)")

    while True:
        try:
            result = await asyncio.get_event_loop().run_in_executor(
                None, _check_disk_now
            )
            _last_check_result = result
            free_gb = result["free_gb"]
            now = time.time()

            if free_gb < CRITICAL_FREE_GB:
                msg = f"CRITICAL disk space: only {free_gb:.1f} GB free (threshold {CRITICAL_FREE_GB} GB)"
                logger.critical(msg)
                if now - _last_critical_at >= INTERVAL_SECONDS:
                    _maybe_fire_sentry(result, "error", msg)
                    if not _paperclip_incident_created:
                        if await _create_paperclip_incident(msg):
                            _paperclip_incident_created = True
                    _last_critical_at = now
            elif free_gb < WARN_FREE_GB:
                msg = f"Disk space low: {free_gb:.1f} GB free (threshold {WARN_FREE_GB} GB)"
                logger.warning(msg)
                if now - _last_warning_at >= INTERVAL_SECONDS:
                    _maybe_fire_sentry(result, "warning", msg)
                    _last_warning_at = now
                # Reset incident flag once back above critical threshold
                _paperclip_incident_created = False
            else:
                logger.info(f"Disk space: {free_gb:.1f} GB free ({result['usage_percent']}% used)")
                # Reset incident flag once back above warn threshold
                _paperclip_incident_created = False
                _last_critical_at = 0.0
                _last_warning_at = 0.0
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("Disk watchdog check failed")

        await asyncio.sleep(INTERVAL_SECONDS)

    logger.info("Disk space watchdog stopped")


async def start_disk_watchdog() -> asyncio.Task:
    return asyncio.create_task(_watchdog_loop())


async def stop_disk_watchdog(task: asyncio.Task) -> None:
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
