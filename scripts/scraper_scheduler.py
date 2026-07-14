#!/usr/bin/env python3
"""
scraper_scheduler.py — Scheduled execution of BuyWhere scrapers.

Orchestrates the existing Python scrapers on configurable intervals.
Each scraper runs as a subprocess, pushing data through the local ingest API,
which sets products.updated_at = NOW() on every upsert.

Usage:
    # Run once (e.g., from cron):
    python scripts/scraper_scheduler.py --run-once

    # Run as a persistent daemon:
    python scripts/scraper_scheduler.py

    # Run specific scrapers:
    python scripts/scraper_scheduler.py --scrapers amazon_us,bestbuy_us_sitemap --run-once

Environment:
    BUYWHERE_API_URL      Base URL for the ingest API (default: http://localhost:3000)
    BUYWHERE_API_KEY       API key with ingest permissions
    SCRAPER_SCHEDULE       JSON dict of scraper -> interval_hours (overrides defaults)
    SCRAPER_DATA_DIR       Directory for scraper output (default: ./data)
"""

import argparse
import asyncio
import json
import os
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# --- Configuration ---

DEFAULT_API_URL = os.environ.get("BUYWHERE_API_URL", "http://localhost:3000")
API_KEY = os.environ.get("BUYWHERE_API_KEY", "")
DATA_DIR = Path(os.environ.get("SCRAPER_DATA_DIR", "./data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_SCHEDULE: dict[str, int] = {
    "amazon_us": 24,
    "bestbuy_us_sitemap": 24,
}

_SCHEDULE_OVERRIDE = os.environ.get("SCRAPER_SCHEDULE")
if _SCHEDULE_OVERRIDE:
    try:
        parsed = json.loads(_SCHEDULE_OVERRIDE)
        if isinstance(parsed, dict):
            DEFAULT_SCHEDULE.update(parsed)
    except json.JSONDecodeError:
        pass


def log(msg: str, **kwargs: Any) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    extra = " ".join(f"{k}={v}" for k, v in kwargs.items())
    print(f"[scraper-scheduler] {ts} {msg}" + (f" ({extra})" if extra else ""), flush=True)

def get_scraper_path(name: str) -> str:
    """Build the Python module path for a scraper."""
    return f"scrapers.{name}"


def get_scraper_command(name: str, api_url: str, api_key: str, data_dir: str, limit: int = 0, scrape_only: bool = False) -> list[str]:
    """Build the CLI command to run a scraper."""
    cmd = [
        sys.executable, "-m", get_scraper_path(name),
        "--api-base", api_url,
        "--batch-size", "100",
        "--delay", "2.0",
    ]
    if api_key:
        cmd.extend(["--api-key", api_key])
    if data_dir:
        cmd.extend(["--output-dir" if name == "amazon_us" else "--data-dir", data_dir])
    if limit > 0:
        cmd.extend(["--limit", str(limit)])
    if scrape_only:
        cmd.append("--scrape-only")
    return cmd


async def run_scraper(name: str, config: dict[str, Any]) -> dict[str, Any]:
    """Run a single scraper and return its result summary."""
    interval = config.get("interval_hours", 24)
    limit = config.get("limit", 0)
    scrape_only = config.get("scrape_only", False)
    api_url = config.get("api_url", DEFAULT_API_URL)
    api_key = config.get("api_key", API_KEY)

    scraper_data_dir = str(DATA_DIR / name)
    Path(scraper_data_dir).mkdir(parents=True, exist_ok=True)

    cmd = get_scraper_command(name, api_url, api_key, scraper_data_dir, limit, scrape_only)

    log(f"Starting scraper: {name}", cmd=" ".join(cmd[-6:]))
    start = time.time()

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=os.getcwd(),
        )

        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=3600)
        elapsed = time.time() - start
        exit_code = proc.returncode or 0

        stdout_str = stdout.decode("utf-8", errors="replace") if stdout else ""
        stderr_str = stderr.decode("utf-8", errors="replace") if stderr else ""

        # Parse summary from stdout (last JSON line)
        summary_lines = [l for l in stdout_str.split("\n") if l.strip().startswith("{")]
        summary: dict[str, Any] = {"exit_code": exit_code, "elapsed_seconds": round(elapsed, 1)}
        if summary_lines:
            try:
                parsed = json.loads(summary_lines[-1])
                if isinstance(parsed, dict):
                    summary.update(parsed)
            except json.JSONDecodeError:
                pass

        if exit_code != 0:
            log(f"Scraper {name} failed", exit_code=exit_code, elapsed=round(elapsed, 1), stderr=stderr_str[-200:])
            summary["error"] = stderr_str[-500:] if stderr_str else "Unknown error"
        else:
            log(f"Scraper {name} completed", exit_code=exit_code, elapsed=round(elapsed, 1),
                scraped=summary.get("total_scraped", "?"), ingested=summary.get("total_ingested", "?"),
                updated=summary.get("total_updated", "?"))

        return summary

    except asyncio.TimeoutError:
        elapsed = time.time() - start
        log(f"Scraper {name} timed out after 3600s", elapsed=round(elapsed, 1))
        return {"exit_code": -1, "elapsed_seconds": round(elapsed, 1), "error": "timeout"}
    except Exception as e:
        elapsed = time.time() - start
        log(f"Scraper {name} raised exception", error=str(e), elapsed=round(elapsed, 1))
        return {"exit_code": -2, "elapsed_seconds": round(elapsed, 1), "error": str(e)}

async def run_one_scraper(name, config):
    return await run_scraper(name, config)

def parse_schedule():
    schedule = {}
    for scraper_name, interval_hours in DEFAULT_SCHEDULE.items():
        schedule[scraper_name] = {
            "interval_hours": interval_hours,
            "last_run": 0,
            "running": False,
        }
    return schedule


async def scheduler_loop(run_once, scraper_filter):
    schedule = parse_schedule()
    if scraper_filter:
        schedule = {k: v for k, v in schedule.items() if k in scraper_filter}
        if not schedule:
            log("No matching scrapers in schedule", filter=",".join(scraper_filter))
            return

    log("Scraper scheduler started", schedule=json.dumps({k: v["interval_hours"] for k, v in schedule.items()}))

    async def health_check():
        try:
            import httpx
            async with httpx.AsyncClient(timeout=5.0) as client:
                url = f"{DEFAULT_API_URL}/health"
                resp = await client.get(url)
                if resp.status_code == 200:
                    return True
                log("Health check failed", status=resp.status_code)
                return False
        except Exception as e:
            log("Health check error", error=str(e))
            return False

    healthy = await health_check()
    if not healthy:
        log("API is not healthy, will continue but ingestion may fail")

    while True:
        now = time.time()
        for scraper_name, cfg in schedule.items():
            if cfg["running"]:
                continue
            hours_since = (now - cfg["last_run"]) / 3600
            if hours_since >= cfg["interval_hours"]:
                cfg["running"] = True
                summary = await run_one_scraper(scraper_name, cfg)
                cfg["last_run"] = time.time()
                cfg["running"] = False
                log(f"Run complete: {scraper_name}", **summary)

        if run_once:
            break

        await asyncio.sleep(60)


def main():
    parser = argparse.ArgumentParser(description="BuyWhere scraper scheduler")
    parser.add_argument("--run-once", action="store_true", help="Run each scraper once and exit")
    parser.add_argument("--scrapers", type=str, help="Comma-separated list of scrapers to run")
    args = parser.parse_args()

    scraper_filter = None
    if args.scrapers:
        scraper_filter = [s.strip() for s in args.scrapers.split(",")]

    try:
        asyncio.run(scheduler_loop(args.run_once, scraper_filter))
    except KeyboardInterrupt:
        log("Scheduler interrupted by signal")


if __name__ == "__main__":
    main()
