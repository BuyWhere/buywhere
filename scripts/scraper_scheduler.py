#!/usr/bin/env python3
"""
Scraper Scheduler — automated re-scraping of all platforms on schedule.

Usage:
    # Run continuously as a daemon (checks schedules and runs scrapers)
    python -m scripts.scraper_scheduler --continuous

    # Run once (check and run any scrapers that are due)
    python -m scripts.scraper_scheduler --once

    # Run a specific platform immediately
    python -m scripts.scraper_scheduler --platform shopee_sg

    # Dry run (show what would run without executing)
    python -m scripts.scraper_scheduler --dry-run

Schedule configuration (PLATFORMS dict below):
    - Shopee SG: every 6 hours
    - Lazada SG: every 12 hours
    - Carousell SG: every 4 hours
    - Qoo10 SG: every 6 hours
    - Fairprice SG: every 8 hours
    - And more...

Schedule log is written to schedule_log.json in the project root.
"""

import argparse
import asyncio
import fcntl
import json
import logging
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.config import get_settings
from app.database import AsyncSessionLocal as async_session_maker
from app.models.product import IngestionRun

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("scraper_scheduler")

settings = get_settings()

LOCK_DIR = Path("/tmp/buywhere_scraper_locks")
LOCK_DIR.mkdir(exist_ok=True)
PIPELINE_LOCK_PATH = LOCK_DIR / "post_scrape_pipeline.lock"

SCHEDULE_LOG_PATH = Path("/home/paperclip/buywhere-api/schedule_log.json")

PLATFORMS = {
    "shopee_sg": {
        "interval_hours": 6,
        "module": "scrapers.shopee_sg",
        "description": "Shopee Singapore",
        "priority": "high",
        "blocked_upstream": True,  # Auth wall — requires Shopee Open Platform API credentials (BUY-480)
    },
    "lazada_sg": {
        "interval_hours": 12,
        "module": "scrapers.lazada_sg",
        "description": "Lazada Singapore",
        "priority": "high",
        "blocked_upstream": True,  # Geo-block/URL restructure — requires Lazada Open Platform API credentials (BUY-480)
    },
    "lazada_sg_eng08": {
        "interval_hours": 12,
        "module": "scrapers.lazada_sg_eng08",
        "description": "Lazada Singapore (eng08)",
        "priority": "medium",
        "blocked_upstream": True,  # Same Lazada geo-block/URL issue (BUY-480)
    },
    "carousell_sg": {
        "interval_hours": 4,
        "module": "scrapers.carousell_sg",
        "description": "Carousell Singapore",
        "priority": "high",
    },
    "qoo10_sg": {
        "interval_hours": 6,
        "module": "scrapers.qoo10_sg",
        "description": "Qoo10 Singapore",
        "priority": "medium",
    },
    "fairprice_sg": {
        "interval_hours": 8,
        "module": "scrapers.fairprice_sg",
        "description": "Fairprice Singapore",
        "priority": "medium",
    },
    "coldstorage_sg": {
        "interval_hours": 8,
        "module": "scrapers.cold_storage_sg",
        "description": "Cold Storage Singapore",
        "priority": "medium",
    },
    "giant_sg": {
        "interval_hours": 8,
        "module": "scrapers.giant_sg",
        "description": "Giant Singapore",
        "priority": "medium",
    },
    "guardian_sg": {
        "interval_hours": 12,
        "module": "scrapers.guardian_sg",
        "description": "Guardian Singapore",
        "priority": "medium",
    },
    "watsons_sg": {
        "interval_hours": 12,
        "module": "scrapers.watsons_sg",
        "description": "Watsons Singapore",
        "priority": "medium",
    },
    "redmart_sg": {
        "interval_hours": 8,
        "module": "scrapers.redmart_sg",
        "description": "RedMart Singapore",
        "priority": "medium",
    },
    "zalora_sg": {
        "interval_hours": 24,
        "module": "scrapers.zalora_sg",
        "description": "Zalora Singapore",
        "priority": "low",
    },
    "uniqlo_sg": {
        "interval_hours": 24,
        "module": "scrapers.uniqlo_sg",
        "description": "UNIQLO Singapore",
        "priority": "low",
    },
    "ikea_sg": {
        "interval_hours": 24,
        "module": "scrapers.ikea_sg",
        "description": "IKEA Singapore",
        "priority": "low",
    },
    "decathlon_sg": {
        "interval_hours": 12,
        "module": "scrapers.decathlon_sg",
        "description": "Decathlon Singapore",
        "priority": "medium",
    },
    "challenger_sg": {
        "interval_hours": 12,
        "module": "scrapers.challenger_sg",
        "description": "Challenger Singapore",
        "priority": "low",
    },
    "courts_sg": {
        "interval_hours": 12,
        "module": "scrapers.courts_sg",
        "description": "Courts Singapore",
        "priority": "low",
    },
    "mustafa_sg": {
        "interval_hours": 6,
        "module": "scrapers.mustafa_sg",
        "description": "Mustafa Singapore",
        "priority": "medium",
    },
    "fortytwo_sg": {
        "interval_hours": 12,
        "module": "scrapers.fortytwo_sg",
        "description": "FortyTwo Singapore",
        "priority": "low",
    },
    "sephora_sg": {
        "interval_hours": 24,
        "module": "scrapers.sephora_sg",
        "description": "Sephora Singapore",
        "priority": "low",
    },
    "nike_sg": {
        "interval_hours": 24,
        "module": "scrapers.nike_sg",
        "description": "Nike Singapore",
        "priority": "low",
    },
    "asos_sg": {
        "interval_hours": 24,
        "module": "scrapers.asos_sg",
        "description": "ASOS Singapore",
        "priority": "low",
    },
    "shein_sg": {
        "interval_hours": 12,
        "module": "scrapers.shein_sg",
        "description": "Shein Singapore",
        "priority": "medium",
    },
    "amazon_sg": {
        "interval_hours": 12,
        "module": "scrapers.amazon_sg",
        "description": "Amazon Singapore",
        "priority": "high",
    },
    "amazon_sg_electronics": {
        "interval_hours": 24,
        "module": "scrapers.amazon_sg_electronics",
        "description": "Amazon SG Electronics",
        "priority": "high",
    },
    "amazon_sg_beauty": {
        "interval_hours": 24,
        "module": "scrapers.amazon_sg_beauty",
        "description": "Amazon SG Beauty",
        "priority": "high",
    },
    "amazon_sg_books": {
        "interval_hours": 24,
        "module": "scrapers.amazon_sg_books",
        "description": "Amazon SG Books",
        "priority": "high",
    },
    "amazon_sg_fashion": {
        "interval_hours": 24,
        "module": "scrapers.amazon_sg_fashion",
        "description": "Amazon SG Fashion",
        "priority": "high",
    },
    "amazon_sg_home_kitchen": {
        "interval_hours": 24,
        "module": "scrapers.amazon_sg_home_kitchen",
        "description": "Amazon SG Home & Kitchen",
        "priority": "high",
    },
    "amazon_sg_grocery": {
        "interval_hours": 24,
        "module": "scrapers.amazon_sg_grocery",
        "description": "Amazon SG Grocery",
        "priority": "high",
    },
    "amazon_sg_baby": {
        "interval_hours": 24,
        "module": "scrapers.amazon_sg_baby",
        "description": "Amazon SG Baby",
        "priority": "medium",
    },
    "amazon_sg_sports": {
        "interval_hours": 24,
        "module": "scrapers.amazon_sg_sports",
        "description": "Amazon SG Sports",
        "priority": "medium",
    },
    "amazon_sg_toys": {
        "interval_hours": 24,
        "module": "scrapers.amazon_sg_toys",
        "description": "Amazon SG Toys",
        "priority": "medium",
    },
    "amazon_sg_garden": {
        "interval_hours": 24,
        "module": "scrapers.amazon_sg_garden",
        "description": "Amazon SG Garden",
        "priority": "medium",
    },
    "amazon_sg_pets": {
        "interval_hours": 24,
        "module": "scrapers.amazon_sg_pets",
        "description": "Amazon SG Pets",
        "priority": "medium",
    },
    "amazon_sg_office": {
        "interval_hours": 24,
        "module": "scrapers.amazon_sg_office",
        "description": "Amazon SG Office",
        "priority": "medium",
    },
    "amazon_sg_tools": {
        "interval_hours": 24,
        "module": "scrapers.amazon_sg_tools",
        "description": "Amazon SG Tools",
        "priority": "medium",
    },
    "bestdenki_sg": {
        "interval_hours": 24,
        "module": "scrapers.bestdenki_sg",
        "description": "Best Denki Singapore",
        "priority": "high",
    },
    "harvey_norman_sg": {
        "interval_hours": 24,
        "module": "scrapers.harvey_norman_sg",
        "description": "Harvey Norman Singapore",
        "priority": "high",
    },
    "popular_sg": {
        "interval_hours": 24,
        "module": "scrapers.popular_sg",
        "description": "Popular Singapore",
        "priority": "medium",
    },
    "metro_sg": {
        "interval_hours": 24,
        "module": "scrapers.metro_sg",
        "description": "Metro Singapore",
        "priority": "medium",
    },
    "robinsons_sg": {
        "interval_hours": 24,
        "module": "scrapers.robinsons_sg",
        "description": "Robinsons Singapore",
        "priority": "medium",
    },
    "ebay_sg": {
        "interval_hours": 24,
        "module": "scrapers.ebay_sg",
        "description": "eBay Singapore",
        "priority": "medium",
    },
    "tangs_sg": {
        "interval_hours": 24,
        "module": "scrapers.tangs_sg",
        "description": "Tangs Singapore",
        "priority": "low",
    },
    "lovebonito_sg": {
        "interval_hours": 24,
        "module": "scrapers.lovebonito_sg",
        "description": "Love Bonito Singapore",
        "priority": "low",
    },
    "iherb_sg": {
        "interval_hours": 24,
        "module": "scrapers.iherb_sg",
        "description": "iHerb Singapore",
        "priority": "low",
    },
    "hm_sg": {
        "interval_hours": 24,
        "module": "scrapers.hm_sg",
        "description": "H&M Singapore",
        "priority": "low",
    },
    "lazada_my": {
        "interval_hours": 12,
        "module": "scrapers.lazada_my",
        "description": "Lazada Malaysia",
        "priority": "medium",
    },
    "shopee_my": {
        "interval_hours": 6,
        "module": "scrapers.shopee_my",
        "description": "Shopee Malaysia",
        "priority": "high",
    },
    "shopee_ph": {
        "interval_hours": 6,
        "module": "scrapers.shopee_ph",
        "description": "Shopee Philippines",
        "priority": "medium",
    },
    "shopee_th": {
        "interval_hours": 6,
        "module": "scrapers.shopee_th",
        "description": "Shopee Thailand",
        "priority": "medium",
    },
    "shopee_vn": {
        "interval_hours": 6,
        "module": "scrapers.shopee_vn",
        "description": "Shopee Vietnam",
        "priority": "medium",
    },
    "lazada_ph": {
        "interval_hours": 12,
        "module": "scrapers.lazada_ph",
        "description": "Lazada Philippines",
        "priority": "medium",
    },
    "lazada_th": {
        "interval_hours": 12,
        "module": "scrapers.lazada_th",
        "description": "Lazada Thailand",
        "priority": "medium",
    },
    "tokopedia_id": {
        "interval_hours": 12,
        "module": "scrapers.tokopedia_id",
        "description": "Tokopedia Indonesia",
        "priority": "high",
    },
    "bukalapak_id": {
        "interval_hours": 12,
        "module": "scrapers.bukalapak_id",
        "description": "Bukalapak Indonesia",
        "priority": "medium",
    },
    "jd_id": {
        "interval_hours": 24,
        "module": "scrapers.jd_id",
        "description": "JD Indonesia",
        "priority": "medium",
    },
    "flipkart_in": {
        "interval_hours": 12,
        "module": "scrapers.flipkart_in",
        "description": "Flipkart India",
        "priority": "medium",
    },
}


def get_lock_path(platform: str) -> Path:
    return LOCK_DIR / f"{platform}.lock"


def is_locked(platform: str) -> bool:
    lock_path = get_lock_path(platform)
    if not lock_path.exists():
        return False
    try:
        with open(lock_path, "r") as f:
            fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)
            return False
    except BlockingIOError:
        return True


def acquire_lock(platform: str) -> Optional[Path]:
    lock_path = get_lock_path(platform)
    try:
        with open(lock_path, "w") as f:
            fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            f.write(f"{os.getpid()}\n{datetime.now(timezone.utc).isoformat()}\n")
            f.flush()
            return lock_path
    except BlockingIOError:
        return None


def release_lock(lock_path: Optional[Path]) -> None:
    if lock_path and lock_path.exists():
        try:
            with open(lock_path, "r") as f:
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)
            lock_path.unlink()
        except Exception as e:
            logger.warning(f"Failed to release lock {lock_path}: {e}")


def run_post_scrape_pipeline(dry_run: bool = False) -> dict:
    lock_path = acquire_lock("post_scrape_pipeline")
    if lock_path is None:
        logger.info("Post-scrape pipeline already running, skipping")
        return {"status": "skipped", "reason": "already_running"}

    try:
        cmd = [sys.executable, "-m", "scripts.pipeline", "--no-scrape"]
        if dry_run:
            cmd.append("--dry-run")

        logger.info("Starting post-scrape pipeline: %s", " ".join(cmd))
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=7200,
            cwd=Path(__file__).parent.parent,
        )

        if result.returncode == 0:
            logger.info("Post-scrape pipeline completed successfully")
            if result.stdout:
                logger.info("Post-scrape pipeline stdout: %s", result.stdout[-1000:])
            return {"status": "completed"}

        logger.error("Post-scrape pipeline failed with code %s", result.returncode)
        if result.stderr:
            logger.error("Post-scrape pipeline stderr: %s", result.stderr[-1000:])
        return {"status": "failed", "reason": result.stderr[-500:] if result.stderr else result.stdout[-500:]}
    except subprocess.TimeoutExpired:
        logger.error("Post-scrape pipeline timed out after 2 hours")
        return {"status": "failed", "reason": "timeout"}
    except Exception as e:
        logger.exception("Post-scrape pipeline exception: %s", e)
        return {"status": "failed", "reason": str(e)}
    finally:
        release_lock(lock_path)


def load_schedule_log() -> dict:
    if not SCHEDULE_LOG_PATH.exists():
        return {"last_updated": None, "platforms": {}}
    try:
        with open(SCHEDULE_LOG_PATH) as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return {"last_updated": None, "platforms": {}}


def save_schedule_log(log_data: dict) -> None:
    log_data["last_updated"] = datetime.now(timezone.utc).isoformat()
    tmp_path = SCHEDULE_LOG_PATH.with_suffix(".json.tmp")
    with open(tmp_path, "w") as f:
        json.dump(log_data, f, indent=2)
    tmp_path.rename(SCHEDULE_LOG_PATH)


def update_schedule_log(
    platform: str,
    status: str,
    rows_inserted: int = 0,
    rows_updated: int = 0,
    rows_failed: int = 0,
    error: Optional[str] = None,
) -> None:
    log_data = load_schedule_log()
    if platform not in log_data["platforms"]:
        log_data["platforms"][platform] = {}

    log_data["platforms"][platform]["last_run"] = datetime.now(timezone.utc).isoformat()
    log_data["platforms"][platform]["last_status"] = status
    log_data["platforms"][platform]["last_run_id"] = None

    if status == "completed":
        log_data["platforms"][platform]["products_scraped"] = rows_inserted + rows_updated
        log_data["platforms"][platform]["products_inserted"] = rows_inserted
        log_data["platforms"][platform]["products_updated"] = rows_updated
        log_data["platforms"][platform]["products_failed"] = rows_failed
        log_data["platforms"][platform]["last_error"] = None
    else:
        log_data["platforms"][platform]["last_error"] = error

    save_schedule_log(log_data)
    logger.info(f"[{platform}] schedule_log.json updated: status={status}, products={rows_inserted + rows_updated}")


async def get_last_run_info(platform: str) -> tuple[Optional[datetime], Optional[str], int, int, int]:
    async with async_session_maker() as db:
        from sqlalchemy import select, func
        result = await db.execute(
            select(
                IngestionRun.finished_at,
                IngestionRun.status,
                IngestionRun.rows_inserted,
                IngestionRun.rows_updated,
                IngestionRun.rows_failed,
            )
            .where(IngestionRun.source == platform)
            .order_by(IngestionRun.finished_at.desc())
            .limit(1)
        )
        row = result.one_or_none()
        if row:
            return (
                row[0],
                row[1],
                row[2] or 0,
                row[3] or 0,
                row[4] or 0,
            )
        return None, None, 0, 0, 0


async def is_due(platform: str, interval_hours: int) -> bool:
    last_finished, last_status, _, _, _ = await get_last_run_info(platform)
    if last_finished is None:
        return True
    if last_status != "completed":
        return True
    now = datetime.now(timezone.utc)
    elapsed = now - last_finished.replace(tzinfo=timezone.utc) if last_finished.tzinfo is None else now - last_finished
    return elapsed >= timedelta(hours=interval_hours)


async def run_scraper(
    platform: str,
    module: str,
    dry_run: bool = False,
    max_retries: int = 3,
) -> dict:
    lock_path = acquire_lock(platform)
    if lock_path is None:
        logger.warning(f"[{platform}] Already running, skipping")
        return {"platform": platform, "status": "skipped", "reason": "already_running"}

    try:
        if dry_run:
            logger.info(f"[{platform}] Dry run - would execute: python -m {module}")
            return {"platform": platform, "status": "dry_run"}

        retry_count = 0
        base_delay = 60

        while retry_count <= max_retries:
            async with async_session_maker() as db:
                run_record = IngestionRun(
                    source=platform,
                    status="running",
                    started_at=datetime.now(timezone.utc),
                )
                db.add(run_record)
                await db.commit()
                run_id = run_record.id

            try:
                logger.info(f"[{platform}] Starting scrape (attempt {retry_count + 1}/{max_retries + 1})")

                result = subprocess.run(
                    [sys.executable, "-m", module],
                    capture_output=True,
                    text=True,
                    timeout=3600,
                )

                async with async_session_maker() as db:
                    from sqlalchemy import select
                    run_record = await db.get(IngestionRun, run_id)
                    if run_record is None:
                        logger.error(f"[{platform}] Run record {run_id} not found")
                        update_schedule_log(platform, "failed", error="run_record_not_found")
                        return {"platform": platform, "status": "error", "reason": "run_record_not_found"}

                    run_record.finished_at = datetime.now(timezone.utc)
                    rows_inserted = 0
                    rows_updated = 0
                    rows_failed = 0

                    if result.returncode == 0:
                        run_record.status = "completed"
                        logger.info(f"[{platform}] Scrape completed successfully")
                        logger.info(f"[{platform}] stdout: {result.stdout[-500:] if len(result.stdout) > 500 else result.stdout}")
                        update_schedule_log(platform, "completed", 0, 0, 0)
                        return {"platform": platform, "status": "completed", "run_id": run_id}
                    else:
                        run_record.status = "failed"
                        run_record.error_message = result.stderr[-2000:] if result.stderr else "Unknown error"
                        logger.error(f"[{platform}] Scrape failed with code {result.returncode}")
                        logger.error(f"[{platform}] stderr: {result.stderr[-500:] if len(result.stderr) > 500 else result.stderr}")
                        update_schedule_log(platform, "failed", error=result.stderr[-500:])

                        if retry_count < max_retries:
                            retry_count += 1
                            delay = base_delay * (2 ** (retry_count - 1))
                            logger.info(f"[{platform}] Retrying in {delay} seconds...")
                            await asyncio.sleep(delay)
                        else:
                            return {"platform": platform, "status": "failed", "reason": result.stderr[-500:]}

            except subprocess.TimeoutExpired:
                async with async_session_maker() as db:
                    run_record = await db.get(IngestionRun, run_id)
                    if run_record:
                        run_record.status = "failed"
                        run_record.error_message = "Timeout after 1 hour"
                        run_record.finished_at = datetime.now(timezone.utc)
                        await db.commit()
                logger.error(f"[{platform}] Scrape timed out after 1 hour")
                update_schedule_log(platform, "failed", error="timeout")

                if retry_count < max_retries:
                    retry_count += 1
                    delay = base_delay * (2 ** (retry_count - 1))
                    logger.info(f"[{platform}] Retrying in {delay} seconds...")
                    await asyncio.sleep(delay)
                else:
                    return {"platform": platform, "status": "failed", "reason": "timeout"}

            except Exception as e:
                async with async_session_maker() as db:
                    run_record = await db.get(IngestionRun, run_id)
                    if run_record:
                        run_record.status = "failed"
                        run_record.error_message = str(e)[:2000]
                        run_record.finished_at = datetime.now(timezone.utc)
                        await db.commit()
                logger.exception(f"[{platform}] Scrape exception: {e}")
                update_schedule_log(platform, "failed", error=str(e))

                if retry_count < max_retries:
                    retry_count += 1
                    delay = base_delay * (2 ** (retry_count - 1))
                    logger.info(f"[{platform}] Retrying in {delay} seconds...")
                    await asyncio.sleep(delay)
                else:
                    return {"platform": platform, "status": "failed", "reason": str(e)}

    finally:
        release_lock(lock_path)

    return {"platform": platform, "status": "failed", "reason": "max_retries_exceeded"}


async def check_and_run_platform(platform: str, config: dict, dry_run: bool = False) -> dict:
    interval_hours = config["interval_hours"]
    module = config["module"]

    if config.get("blocked_upstream"):
        logger.info(f"[{platform}] Blocked upstream — skipping (see BUY-480)")
        return {"platform": platform, "status": "skipped", "reason": "blocked_upstream"}

    if is_locked(platform):
        logger.info(f"[{platform}] Currently locked (running), skipping")
        return {"platform": platform, "status": "skipped", "reason": "currently_running"}

    due = await is_due(platform, interval_hours)
    last_finished, last_status, rows_inserted, rows_updated, rows_failed = await get_last_run_info(platform)

    if not due:
        next_run = last_finished.replace(tzinfo=timezone.utc) + timedelta(hours=interval_hours) if last_finished else None
        logger.debug(f"[{platform}] Not due yet. Last: {last_finished}, Status: {last_status}, Next: {next_run}")
        return {"platform": platform, "status": "not_due", "last_run": str(last_finished), "next_run": str(next_run) if next_run else None}

    logger.info(f"[{platform}] Due for scrape (interval: {interval_hours}h, last: {last_finished})")
    return await run_scraper(platform, module, dry_run=dry_run)


async def run_continuous(check_interval: int = 300):
    logger.info(f"Starting continuous scheduler (check interval: {check_interval}s)")
    logger.info(f"Monitoring {len(PLATFORMS)} platforms")

    log_data = load_schedule_log()
    for platform in PLATFORMS:
        if platform not in log_data["platforms"]:
            log_data["platforms"][platform] = {
                "last_run": None,
                "last_status": None,
                "products_scraped": 0,
                "products_inserted": 0,
                "products_updated": 0,
                "products_failed": 0,
                "last_error": None,
            }
    save_schedule_log(log_data)

    while True:
        completed_scrapes = False
        for platform, config in PLATFORMS.items():
            try:
                result = await check_and_run_platform(platform, config)
                completed_scrapes = completed_scrapes or result.get("status") == "completed"
            except Exception as e:
                logger.exception(f"[{platform}] Error in check_and_run: {e}")

        if completed_scrapes:
            pipeline_result = run_post_scrape_pipeline()
            logger.info("Post-scrape pipeline result: %s", pipeline_result)

        logger.info(f"Cycle complete. Sleeping for {check_interval}s...")
        await asyncio.sleep(check_interval)


async def run_once(dry_run: bool = False) -> list:
    logger.info(f"Running one-shot scheduler check (dry_run={dry_run})")

    log_data = load_schedule_log()
    for platform in PLATFORMS:
        if platform not in log_data["platforms"]:
            log_data["platforms"][platform] = {
                "last_run": None,
                "last_status": None,
                "products_scraped": 0,
                "products_inserted": 0,
                "products_updated": 0,
                "products_failed": 0,
                "last_error": None,
            }
    save_schedule_log(log_data)

    results = []
    completed_scrapes = False
    for platform, config in PLATFORMS.items():
        try:
            result = await check_and_run_platform(platform, config, dry_run=dry_run)
            results.append(result)
            completed_scrapes = completed_scrapes or result.get("status") == "completed"
        except Exception as e:
            logger.exception(f"[{platform}] Error: {e}")
            results.append({"platform": platform, "status": "error", "reason": str(e)})

    if completed_scrapes:
        pipeline_result = run_post_scrape_pipeline(dry_run=dry_run)
        results.append({"platform": "post_scrape_pipeline", **pipeline_result})
    return results


async def run_specific_platform(platform: str, dry_run: bool = False) -> dict:
    if platform not in PLATFORMS:
        return {"platform": platform, "status": "error", "reason": f"Unknown platform: {platform}. Available: {list(PLATFORMS.keys())}"}

    config = PLATFORMS[platform]
    logger.info(f"Forcing run for {platform}")
    return await run_scraper(platform, config["module"], dry_run=dry_run)


def print_schedule_log():
    log_data = load_schedule_log()
    print(json.dumps(log_data, indent=2))


async def main():
    parser = argparse.ArgumentParser(description="BuyWhere Scraper Scheduler")
    parser.add_argument(
        "--continuous",
        action="store_true",
        help="Run continuously as a daemon",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run once (check and run any due scrapers)",
    )
    parser.add_argument(
        "--platform",
        type=str,
        help="Run a specific platform immediately",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would run without executing",
    )
    parser.add_argument(
        "--check-interval",
        type=int,
        default=300,
        help="Check interval in seconds for continuous mode (default: 300)",
    )
    parser.add_argument(
        "--log",
        action="store_true",
        help="Print current schedule_log.json and exit",
    )
    args = parser.parse_args()

    if args.log:
        print_schedule_log()
        return

    if args.continuous:
        await run_continuous(check_interval=args.check_interval)
    elif args.platform:
        result = await run_specific_platform(args.platform, dry_run=args.dry_run)
        print(f"Result: {result}")
    elif args.once:
        results = await run_once(dry_run=args.dry_run)
        print(f"Results: {results}")
        completed = sum(1 for r in results if r["status"] == "completed")
        failed = sum(1 for r in results if r["status"] == "failed")
        skipped = sum(1 for r in results if r["status"] in ("skipped", "not_due"))
        logger.info(f"Summary: {completed} completed, {failed} failed, {skipped} skipped/not_due")
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
