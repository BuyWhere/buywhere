import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models.product import Product, ProductDataFreshness
from app.logging_centralized import get_logger

logger = get_logger("product-freshness-service")

# Configuration
HOURLY_SNAPSHOT_ENABLED = True
STALE_COUNT_THRESHOLD_HOURS = int(os.environ.get("CATALOG_FRESHNESS_FLAT_THRESHOLD_HOURS", "6"))
MIN_PRODUCT_COUNT_CHANGE = int(os.environ.get("CATALOG_FRESHNESS_MIN_COUNT_CHANGE", "10"))
ALERT_STATE_FILE = Path(os.environ.get("CATALOG_FRESHNESS_ALERT_STATE_FILE", "/home/paperclip/buywhere-api/data/catalog_freshness_alert_state.json"))
DATA_DIR = Path(os.environ.get("CATALOG_FRESHNESS_DATA_DIR", "/home/paperclip/buywhere-api/data"))


def _compute_hours_since(dt: datetime) -> Optional[float]:
    """Compute hours since a datetime"""
    if dt is None:
        return None
    delta = datetime.now(timezone.utc) - dt
    return delta.total_seconds() / 3600


def _normalise_source(source: str | None) -> str:
    return source or "all"


async def get_latest_product_count(source: str | None = None) -> Optional[dict]:
    """Get the latest product count from the freshness table"""
    async with AsyncSessionLocal() as db:
        query = select(ProductDataFreshness).order_by(ProductDataFreshness.snapshot_time.desc())
        query = query.where(ProductDataFreshness.source == _normalise_source(source))
        query = query.limit(1)
        
        result = await db.execute(query)
        row = result.scalar_one_or_none()
        
        if row:
            return {
                "source": row.source,
                "product_count": row.product_count,
                "snapshot_time": row.snapshot_time,
                "hours_since": _compute_hours_since(row.snapshot_time)
            }
        return None


async def get_product_count_trend(source: str | None = None, hours: int = 24) -> dict:
    """Get product count trend over specified hours"""
    async with AsyncSessionLocal() as db:
        since_time = datetime.now(timezone.utc) - timedelta(hours=hours)
        query = select(ProductDataFreshness).where(
            ProductDataFreshness.snapshot_time >= since_time
        ).order_by(ProductDataFreshness.snapshot_time.asc())
        
        query = query.where(ProductDataFreshness.source == _normalise_source(source))
            
        result = await db.execute(query)
        rows = result.scalars().all()
        
        if not rows:
            return {"trend": [], "is_stale": False, "hours_flat": 0}
            
        # Convert to list of dicts
        trend_data = [
            {
                "snapshot_time": row.snapshot_time,
                "product_count": row.product_count,
                "hours_ago": _compute_hours_since(row.snapshot_time)
            }
            for row in rows
        ]
        
        # Check if count has been flat for too long
        is_stale, hours_flat = await _is_count_flat(trend_data, STALE_COUNT_THRESHOLD_HOURS)
        
        return {
            "trend": trend_data,
            "is_stale": is_stale,
            "hours_flat": hours_flat
        }


async def _is_count_flat(trend_data: List[dict], threshold_hours: int) -> tuple[bool, float]:
    """Check if product count has been flat (no significant change) for threshold_hours"""
    if len(trend_data) < 2:
        return False, 0.0
        
    # Get the oldest and newest snapshots within the threshold
    cutoff_time = datetime.now(timezone.utc) - timedelta(hours=threshold_hours)
    recent_data = [
        item for item in trend_data 
        if item["snapshot_time"] >= cutoff_time
    ]
    
    if len(recent_data) < 2:
        return False, 0.0
        
    # Check if the count has changed significantly
    oldest_count = recent_data[0]["product_count"]
    newest_count = recent_data[-1]["product_count"]
    
    change = abs(newest_count - oldest_count)
    hours_flat = _compute_hours_since(recent_data[0]["snapshot_time"])
    
    is_flat = change < MIN_PRODUCT_COUNT_CHANGE
    return is_flat, hours_flat


async def record_product_count(source: str | None = None) -> bool:
    """Record current product count to the freshness table"""
    try:
        async with AsyncSessionLocal() as db:
            # Get current product count
            query = select(func.count(Product.id))
            source_name = _normalise_source(source)
            if source_name != "all":
                query = query.where(Product.source == source)
                
            result = await db.execute(query)
            count = result.scalar_one()
            
            # Create freshness record
            freshness_record = ProductDataFreshness(
                source=source_name,
                product_count=count,
                snapshot_time=datetime.now(timezone.utc)
            )
            
            db.add(freshness_record)
            await db.commit()
            
            logger.info(f"Recorded product count for {source_name}: {count}")
            return True
            
    except Exception as e:
        logger.error(f"Failed to record product count: {e}")
        return False


async def record_hourly_product_counts() -> dict:
    """Record all-catalog and per-source product count snapshots."""
    results = {"all": await record_product_count("all"), "sources": {}}

    async with AsyncSessionLocal() as db:
        source_result = await db.execute(
            select(Product.source)
            .where(Product.source.isnot(None), Product.source != "")
            .group_by(Product.source)
        )
        sources = [row[0] for row in source_result.all()]

    for source in sources:
        results["sources"][source] = await record_product_count(source)

    return results


async def check_for_stalled_ingestion(source: str | None = None) -> Optional[dict]:
    """Check if ingestion has stalled (product count flat for too long)"""
    trend_data = await get_product_count_trend(source, hours=STALE_COUNT_THRESHOLD_HOURS * 2)
    
    if trend_data["is_stale"]:
        alert = {
            "type": "ingestion_stalled",
            "source": _normalise_source(source),
            "message": f"Product count has been flat for {trend_data['hours_flat']:.1f} hours",
            "hours_flat": trend_data["hours_flat"],
            "current_count": trend_data["trend"][-1]["product_count"] if trend_data["trend"] else 0,
            "snapshot_time": trend_data["trend"][-1]["snapshot_time"] if trend_data["trend"] else None
        }
        
        logger.warning(f"INGESTION STALLED: {alert['message']}")
        return alert
        
    return None


async def get_unprocessed_ndjson_files(data_dir: Path | None = None) -> List[dict]:
    """Check for scraped NDJSON files on disk that haven't been ingested"""
    unprocessed_files = []

    data_dir = data_dir or DATA_DIR
    if not data_dir.exists():
        return unprocessed_files
        
    # Look for platform directories
    for platform_dir in data_dir.iterdir():
        if platform_dir.is_dir() and not platform_dir.name.startswith('.'):
            # Look for NDJSON files
            for ndjson_file in platform_dir.glob("*.ndjson"):
                # Check if file was modified in the last 24 hours
                mtime = datetime.fromtimestamp(ndjson_file.stat().st_mtime, tz=timezone.utc)
                hours_since_modified = _compute_hours_since(mtime)
                
                if hours_since_modified is not None and hours_since_modified < 24:
                    # Check if we have a recent ingestion record for this source
                    latest_record = await get_latest_product_count(platform_dir.name)

                    # If no recent record or file is newer than last ingestion, it's unprocessed
                    if not latest_record or mtime > latest_record["snapshot_time"]:
                        unprocessed_files.append({
                            "platform": platform_dir.name,
                            "file_path": str(ndjson_file),
                            "file_size_mb": ndjson_file.stat().st_size / (1024 * 1024),
                            "last_modified": mtime,
                            "hours_since_scrape": hours_since_modified,
                            "last_ingestion": latest_record["snapshot_time"] if latest_record else None
                        })
    
    return unprocessed_files


async def build_catalog_freshness_monitor_report(
    source: str | None = None,
    data_dir: Path | None = None,
    trend_hours: int = 24,
) -> dict:
    """Build the backend monitor payload consumed by the catalog dashboard."""
    source_name = _normalise_source(source)
    latest = await get_latest_product_count(source_name)
    trend = await get_product_count_trend(source_name, hours=trend_hours)
    stalled = await check_for_stalled_ingestion(source_name)
    unprocessed = await get_unprocessed_ndjson_files(data_dir=data_dir)

    return {
        "generated_at": datetime.now(timezone.utc),
        "source": source_name,
        "flat_threshold_hours": STALE_COUNT_THRESHOLD_HOURS,
        "min_product_count_change": MIN_PRODUCT_COUNT_CHANGE,
        "latest_snapshot": latest,
        "trend": trend,
        "stalled_ingestion": stalled,
        "unprocessed_ndjson_files": unprocessed,
        "unprocessed_ndjson_count": len(unprocessed),
    }


def _load_alert_state() -> dict:
    try:
        if ALERT_STATE_FILE.exists():
            return json.loads(ALERT_STATE_FILE.read_text())
    except Exception as exc:
        logger.warning(f"Failed to read freshness alert state: {exc}")
    return {}


def _save_alert_state(state: dict) -> None:
    try:
        ALERT_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        ALERT_STATE_FILE.write_text(json.dumps(state, indent=2, sort_keys=True))
    except Exception as exc:
        logger.warning(f"Failed to write freshness alert state: {exc}")


def _should_post_alert(state: dict, alert_key: str, now: datetime, cooldown_hours: int = 6) -> bool:
    last_posted = state.get(alert_key)
    if not last_posted:
        return True
    try:
        last_posted_at = datetime.fromisoformat(last_posted)
        if last_posted_at.tzinfo is None:
            last_posted_at = last_posted_at.replace(tzinfo=timezone.utc)
        return (now - last_posted_at).total_seconds() >= cooldown_hours * 3600
    except ValueError:
        return True


def format_freshness_alert_comment(report: dict) -> str:
    stalled = report.get("stalled_ingestion")
    files = report.get("unprocessed_ndjson_files", [])
    lines = [
        "Catalog freshness monitor alert",
        "",
        f"- Generated at: `{report['generated_at'].isoformat()}`",
        f"- Source: `{report['source']}`",
    ]

    if stalled:
        lines.extend([
            f"- Product count has been flat for `{stalled['hours_flat']:.1f}` hours",
            f"- Current product count: `{stalled['current_count']}`",
            f"- Flat threshold: `{report['flat_threshold_hours']}` hours",
        ])

    if files:
        lines.append(f"- Unprocessed NDJSON files detected: `{len(files)}`")
        for item in files[:10]:
            lines.append(
                f"  - `{item['platform']}` `{item['file_path']}` "
                f"({item['file_size_mb']:.2f} MB, modified {item['hours_since_scrape']:.1f}h ago)"
            )

    return "\n".join(lines)


async def post_paperclip_issue_comment(issue_id: str, body: str) -> bool:
    api_url = os.environ.get("PAPERCLIP_API_URL")
    api_key = os.environ.get("PAPERCLIP_API_KEY")
    run_id = os.environ.get("PAPERCLIP_RUN_ID")
    if not api_url or not api_key:
        logger.warning("Paperclip alert skipped: PAPERCLIP_API_URL or PAPERCLIP_API_KEY missing")
        return False

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    if run_id:
        headers["X-Paperclip-Run-Id"] = run_id

    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(
            f"{api_url.rstrip('/')}/api/issues/{issue_id}/comments",
            headers=headers,
            json={"body": body},
        )
        if response.status_code < 400:
            return True
        logger.warning(f"Paperclip alert failed: {response.status_code} {response.text[:200]}")
        return False


async def run_catalog_freshness_monitor_once(
    alert_issue_id: str | None = None,
    data_dir: Path | None = None,
) -> dict:
    """Record snapshots, evaluate stale-count and NDJSON backlog alerts, and optionally comment in Paperclip."""
    await record_hourly_product_counts()
    report = await build_catalog_freshness_monitor_report(data_dir=data_dir)

    alert_issue_id = alert_issue_id or os.environ.get("CATALOG_FRESHNESS_ALERT_ISSUE_ID") or os.environ.get("PAPERCLIP_TASK_ID")
    has_alert = bool(report.get("stalled_ingestion")) or report.get("unprocessed_ndjson_count", 0) > 0
    posted = False

    if has_alert and alert_issue_id:
        now = datetime.now(timezone.utc)
        state = _load_alert_state()
        alert_key = f"catalog_freshness:{report['source']}"
        if _should_post_alert(state, alert_key, now):
            posted = await post_paperclip_issue_comment(alert_issue_id, format_freshness_alert_comment(report))
            if posted:
                state[alert_key] = now.isoformat()
                _save_alert_state(state)

    report["alert_posted"] = posted
    return report
