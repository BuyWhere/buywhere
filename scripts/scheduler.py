#!/usr/bin/env python3
"""
Scraper Scheduler — automated re-scraping of all platforms on schedule.

BUY-750

Usage:
    # Run continuously as a daemon (checks schedules and runs scrapers)
    python -m scripts.scheduler --continuous

    # Run once (check and run any scrapers that are due)
    python -m scripts.scheduler --once

    # Run a specific platform immediately
    python -m scripts.scheduler --platform shopee_sg

    # Dry run (show what would run without executing)
    python -m scripts.scheduler --dry-run

Schedule configuration (PLATFORMS dict below):
    - Shopee SG: every 6 hours
    - Lazada SG: every 12 hours
    - Carousell SG: every 4 hours
    - Qoo10 SG: every 6 hours
    - Fairprice SG: every 8 hours
    - And more...
"""

import argparse
import asyncio
import fcntl
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

PLATFORMS = {
    "shopee_sg": {
        "interval_hours": 6,
        "module": "scrapers.shopee_sg",
        "description": "Shopee Singapore",
        "priority": "high",
    },
    "lazada_sg": {
        "interval_hours": 12,
        "module": "scrapers.lazada_sg",
        "description": "Lazada Singapore",
        "priority": "high",
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


async def get_last_run_info(platform: str) -> tuple[Optional[datetime], Optional[str]]:
    async with async_session_maker() as db:
        from sqlalchemy import select, func
        result = await db.execute(
            select(IngestionRun.finished_at, IngestionRun.status)
            .where(IngestionRun.source == platform)
            .order_by(IngestionRun.finished_at.desc())
            .limit(1)
        )
        row = result.one_or_none()
        if row:
            return row[0], row[1]
        return None, None


async def is_due(platform: str, interval_hours: int) -> bool:
    last_finished, last_status = await get_last_run_info(platform)
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
                        return {"platform": platform, "status": "error", "reason": "run_record_not_found"}

                    run_record.finished_at = datetime.now(timezone.utc)

                    if result.returncode == 0:
                        run_record.status = "completed"
                        logger.info(f"[{platform}] Scrape completed successfully")
                        logger.info(f"[{platform}] stdout: {result.stdout[-500:] if len(result.stdout) > 500 else result.stdout}")
                        return {"platform": platform, "status": "completed", "run_id": run_id}
                    else:
                        run_record.status = "failed"
                        run_record.error_message = result.stderr[-2000:] if result.stderr else "Unknown error"
                        logger.error(f"[{platform}] Scrape failed with code {result.returncode}")
                        logger.error(f"[{platform}] stderr: {result.stderr[-500:] if len(result.stderr) > 500 else result.stderr}")

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

    if is_locked(platform):
        logger.info(f"[{platform}] Currently locked (running), skipping")
        return {"platform": platform, "status": "skipped", "reason": "currently_running"}

    due = await is_due(platform, interval_hours)
    last_finished, last_status = await get_last_run_info(platform)

    if not due:
        next_run = last_finished.replace(tzinfo=timezone.utc) + timedelta(hours=interval_hours) if last_finished else None
        logger.debug(f"[{platform}] Not due yet. Last: {last_finished}, Status: {last_status}, Next: {next_run}")
        return {"platform": platform, "status": "not_due", "last_run": str(last_finished), "next_run": str(next_run) if next_run else None}

    logger.info(f"[{platform}] Due for scrape (interval: {interval_hours}h, last: {last_finished})")
    return await run_scraper(platform, module, dry_run=dry_run)


async def run_continuous(check_interval: int = 300):
    logger.info(f"Starting continuous scheduler (check interval: {check_interval}s)")
    logger.info(f"Monitoring {len(PLATFORMS)} platforms")

    while True:
        cycle_had_completed_scrapes = False
        for platform, config in PLATFORMS.items():
            try:
                result = await check_and_run_platform(platform, config)
                if result.get("status") == "completed":
                    cycle_had_completed_scrapes = True
            except Exception as e:
                logger.exception(f"[{platform}] Error in check_and_run: {e}")

        if cycle_had_completed_scrapes:
            pipeline_result = run_post_scrape_pipeline()
            logger.info("Post-scrape pipeline result: %s", pipeline_result)

        logger.info(f"Cycle complete. Sleeping for {check_interval}s...")
        await asyncio.sleep(check_interval)


async def run_once(dry_run: bool = False) -> list:
    logger.info(f"Running one-shot scheduler check (dry_run={dry_run})")
    results = []
    for platform, config in PLATFORMS.items():
        try:
            result = await check_and_run_platform(platform, config, dry_run=dry_run)
            results.append(result)
        except Exception as e:
            logger.exception(f"[{platform}] Error: {e}")
            results.append({"platform": platform, "status": "error", "reason": str(e)})

    if any(result.get("status") == "completed" for result in results):
        pipeline_result = run_post_scrape_pipeline(dry_run=dry_run)
        results.append({"platform": "post_scrape_pipeline", **pipeline_result})

    return results


async def run_specific_platform(platform: str, dry_run: bool = False) -> dict:
    if platform not in PLATFORMS:
        return {"platform": platform, "status": "error", "reason": f"Unknown platform: {platform}. Available: {list(PLATFORMS.keys())}"}

    config = PLATFORMS[platform]
    logger.info(f"Forcing run for {platform}")
    return await run_scraper(platform, config["module"], dry_run=dry_run)


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
    args = parser.parse_args()

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
