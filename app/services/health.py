"""Health check service stub."""
from datetime import datetime, timezone
from typing import Any, Dict
import time


async def get_db_health(db) -> Dict[str, Any]:
    from sqlalchemy import text
    ok = True
    try:
        await db.execute(text("SELECT 1"))
    except Exception:
        ok = False
    return {
        "ok": ok,
        "connection": {"ok": ok, "latency_ms": 0.0},
        "pool": {"size": 0, "checked_in": 0, "checked_out": 0, "overflow": 0, "invalid": 0},
        "checked_at": datetime.now(timezone.utc),
    }


async def check_disk_space() -> Dict[str, Any]:
    import shutil
    total, used, free = shutil.disk_usage("/")
    pct = used / total * 100
    return {
        "total_bytes": total,
        "used_bytes": used,
        "available_bytes": free,
        "usage_percent": round(pct, 1),
        "ok": pct < 90,
    }


async def check_api_self_test(db) -> Dict[str, Any]:
    from sqlalchemy import text
    start = time.perf_counter()
    ok = True
    try:
        await db.execute(text("SELECT 1"))
    except Exception:
        ok = False
    latency = (time.perf_counter() - start) * 1000
    return {
        "endpoint": "/v1/health",
        "latency_ms": round(latency, 2),
        "ok": ok,
    }