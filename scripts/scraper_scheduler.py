#!/usr/bin/env python3
"""
Scraper scheduler daemon — runs a named scraper continuously across heartbeats.

Usage:
    # Continuous mode (daemon):
    python scripts/scraper_scheduler.py --continuous --platform carousell_sg

    # Single run:
    python scripts/scraper_scheduler.py --platform carousell_sg --test-limit 50

Environment variables:
    SCRAPERAPI_KEY     Optional. RETIRED 2026-08-07 — proxy subscriptions cancelled;
                       scrapers run direct-fetch only (consent-based crawling policy).
    BUYWHERE_API_KEY   Optional. Required only when not using --scrape-only.
    RUN_BUDGET_SECONDS Default: 14400 (4 h). Max wall-clock per invocation.
    MAX_RESTARTS       Default: 50. Max restart loops before exiting.
    PER_PAGE_DELAY     Default: 1.5 (s). Delay between category pages.

The daemon is designed to be restartable on crash/heartbeat-expiry without
losing progress: the scraper class de-duplicates via seen-sku sets written
to the JSONL output directory.
"""
import argparse
import asyncio
import json
import os
import subprocess
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent.resolve()
BUYWHERE_API_DIR = SCRIPT_DIR.parent
OUTPUT_BASE = BUYWHERE_API_DIR / "data"

SCRAPER_MODULE_MAP = {
    "carousell_sg": {
        "module": "scrapers.carousell_sg",
        "output_dir": "carousell-sg",
        "default_args": ["--scrape-only"],
        "page_limit": 5,
        "concurrency": 6,
        "batch_size": 50,
    },
    "takashimaya_sg": {
        "module": "scrapers.takashimaya_sg",
        "output_dir": "takashimaya_sg",
        "default_args": ["--scrape-only", "--expand-subcategories"],
        "per_category_limit": 100,
        "concurrency": 4,
        "batch_size": 25,
        "page_size": 126,
    },
    "harvey_norman_sg": {
        "module": "scrapers.harvey_norman_sg",
        "output_dir": "harvey-norman",
        "default_args": ["--scrape-only"],
        "concurrency": 8,
        "batch_size": 100,
    },
    # BUY-42971: 6 new SG scrapers
    "amazon_sg_beauty": {
        "module": "scrapers.amazon_sg_beauty",
        "output_dir": "amazon-sg-beauty",
        "default_args": ["--scrape-only"],
        "concurrency": 4,
        "batch_size": 50,
    },
    "amazon_sg_electronics": {
        "module": "scrapers.amazon_sg_electronics",
        "output_dir": "amazon-sg-electronics",
        "default_args": ["--scrape-only"],
        "concurrency": 4,
        "batch_size": 50,
    },
    "asos_sg": {
        "module": "scrapers.asos_sg",
        "output_dir": "asos-sg",
        "default_args": ["--scrape-only"],
        "concurrency": 6,
        "batch_size": 50,
    },
    "challenger_sg": {
        "module": "scrapers.challenger_sg",
        "output_dir": "challenger-sg",
        "default_args": ["--scrape-only"],
        "concurrency": 4,
        "batch_size": 50,
    },
    "mustafa_sg": {
        "module": "scrapers.mustafa_sg",
        "output_dir": "mustafa-sg",
        "default_args": ["--scrape-only"],
        "concurrency": 4,
        "batch_size": 50,
    },
    "sephora_sg": {
        "module": "scrapers.sephora_sg",
        "output_dir": "sephora-sg",
        "default_args": ["--scrape-only"],
        "concurrency": 4,
        "batch_size": 50,
    },
}


def _log(msg: str) -> None:
    print(f"[scraper_scheduler] {msg}", flush=True)


def _get_state_file(platform: str) -> Path:
    d = OUTPUT_BASE / SCRAPER_MODULE_MAP[platform]["output_dir"]
    d.mkdir(parents=True, exist_ok=True)
    return d / "scheduler_state.json"


def _read_state(platform: str) -> dict:
    sf = _get_state_file(platform)
    if sf.exists():
        try:
            return json.loads(sf.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def _write_state(platform: str, state: dict) -> None:
    sf = _get_state_file(platform)
    sf.write_text(json.dumps(state, indent=2))


def _get_pid_file(platform: str) -> Path:
    d = OUTPUT_BASE / SCRAPER_MODULE_MAP[platform]["output_dir"]
    d.mkdir(parents=True, exist_ok=True)
    return d / "scheduler.pid"


def _write_pid(platform: str) -> None:
    _get_pid_file(platform).write_text(str(os.getpid()))


def _build_python_cmd(platform: str, args: argparse.Namespace) -> list[str]:
    info = SCRAPER_MODULE_MAP[platform]
    cmd = [
        sys.executable, "-m", info["module"],
    ]

    if args.test_limit:
        cmd += ["--test-limit", str(args.test_limit)]
    else:
        for dflt in info.get("default_args", []):
            cmd.append(dflt)

    if getattr(args, "scrape_only", False) or (not args.test_limit and "--scrape-only" in info.get("default_args", [])):
        pass  # already in default_args or set via flag
    elif not args.test_limit:
        if "--scrape-only" not in cmd:
            cmd.append("--scrape-only")

    if args.concurrency or "concurrency" in info:
        cmd += ["--concurrency", str(args.concurrency or info.get("concurrency", 4))]

    if args.batch_size or "batch_size" in info:
        cmd += ["--batch-size", str(args.batch_size or info.get("batch_size", 50))]

    if args.page_limit or "page_limit" in info:
        cmd += ["--page-limit", str(args.page_limit or info.get("page_limit", 5))]

    if args.per_category_limit or "per_category_limit" in info:
        cmd += ["--per-category-limit", str(args.per_category_limit or info.get("per_category_limit", 0))]

    if args.page_size or "page_size" in info:
        cmd += ["--page-size", str(args.page_size or info.get("page_size", 126))]

    output_dir = OUTPUT_BASE / info["output_dir"]
    cmd += ["--output-dir", str(output_dir)]

    if args.categories:
        cmd += ["--categories"] + list(args.categories)

    return cmd


async def _run_continuous(platform: str, args: argparse.Namespace) -> None:
    """Restart loop: run the scraper, restart on crash/budget until MAX_RESTARTS."""
    run_budget = int(os.environ.get("RUN_BUDGET_SECONDS", 14400))
    max_restarts = int(os.environ.get("MAX_RESTARTS", 50))

    state = _read_state(platform)
    state.update({
        "platform": platform,
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "pid": os.getpid(),
        "run_budget_seconds": run_budget,
        "restarts": 0,
        "last_status": "starting",
    })
    _write_state(platform, state)
    _write_pid(platform)

    _log(f"Starting continuous mode for platform={platform}")
    _log(f"  run_budget={run_budget}s, max_restarts={max_restarts}")
    _log(f"  WORKSPACE={BUYWHERE_API_DIR}")

    restarts = 0
    run_start = time.time()

    while restarts < max_restarts:
        elapsed = time.time() - run_start
        if elapsed >= run_budget:
            _log(f"Budget exhausted after {elapsed:.0f}s; exiting cleanly")
            state = _read_state(platform)
            state["last_status"] = "budget_exhausted"
            state["completed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            _write_state(platform, state)
            return

        ts = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
        scraper_info = SCRAPER_MODULE_MAP[platform]
        output_dir = OUTPUT_BASE / scraper_info["output_dir"]
        log_dir = BUYWHERE_API_DIR / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        log_file = log_dir / f"{platform}_scheduler_{ts}.log"

        cmd = _build_python_cmd(platform, args)
        _log(f"[restart={restarts}] starting at {ts}")
        _log(f"  cmd: {' '.join(cmd)}")
        _log(f"  log: {log_file}")

        env = {
            "SCRAPERAPI_KEY": os.environ.get("SCRAPERAPI_KEY", ""),
            "BUYWHERE_API_KEY": os.environ.get("BUYWHERE_API_KEY", ""),
        }
        if not env["SCRAPERAPI_KEY"]:
            _log("NOTE: SCRAPERAPI_KEY not set (retired 2026-08-07) — running direct-fetch")
            state = _read_state(platform)
            state["last_status"] = "error_no_scraperapi_key"
            _write_state(platform, state)
            return

        env = {k: v for k, v in env.items() if v}

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=str(BUYWHERE_API_DIR),
                env=env,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )

            # Stream stdout to log file
            log_fh = open(log_file, "wb")
            last_line = b""

            async def pump() -> None:
                assert proc.stdout is not None
                while True:
                    chunk = await proc.stdout.read(4096)
                    if not chunk:
                        break
                    log_fh.write(chunk)
                    log_fh.flush()
                    last_line = chunk

            await pump()
            rc = await proc.wait()
            log_fh.close()

            state = _read_state(platform)
            state["restarts"] = restarts

            if rc == 0:
                _log(f"[restart={restarts}] completed cleanly (rc=0)")
                state["last_status"] = "completed_clean"
            else:
                _log(f"[restart={restarts}] exited with rc={rc}; will retry")
                state["last_status"] = f"exit_{rc}"

            state["last_restart_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            _write_state(platform, state)

        except Exception as e:
            _log(f"[restart={restarts}] exception: {e}")
            state = _read_state(platform)
            state["restarts"] = restarts
            state["last_status"] = f"exception_{type(e).__name__}"
            _write_state(platform, state)

        restarts += 1
        await asyncio.sleep(5)

    _log(f"Hit MAX_RESTARTS={max_restarts}; exiting")
    state = _read_state(platform)
    state["last_status"] = "max_restarts_exceeded"
    state["completed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    _write_state(platform, state)


def main() -> None:
    parser = argparse.ArgumentParser(description="Scraper scheduler daemon")
    parser.add_argument(
        "--continuous", action="store_true",
        help="Run continuously (restart loop). Default: single run."
    )
    parser.add_argument(
        "--platform", required=True,
        choices=list(SCRAPER_MODULE_MAP.keys()),
        help="Scraper platform to run."
    )
    parser.add_argument("--test-limit", type=int, default=0,
                        help="Limit total products (test mode).")
    parser.add_argument("--scrape-only", action="store_true",
                        help="Skip API ingest; write JSONL only.")
    parser.add_argument("--concurrency", type=int, default=0)
    parser.add_argument("--batch-size", type=int, default=0)
    parser.add_argument("--page-limit", type=int, default=0,
                        help="Max pages per category.")
    parser.add_argument("--per-category-limit", type=int, default=0)
    parser.add_argument("--page-size", type=int, default=0)
    parser.add_argument("--categories", nargs="+", default=None,
                        help="Override category list.")
    args = parser.parse_args()

    if args.continuous:
        asyncio.run(_run_continuous(args.platform, args))
    else:
        cmd = _build_python_cmd(args.platform, args)
        _log(f"Single run: {' '.join(cmd)}")
        env = {
            "SCRAPERAPI_KEY": os.environ.get("SCRAPERAPI_KEY", ""),
            "BUYWHERE_API_KEY": os.environ.get("BUYWHERE_API_KEY", ""),
        }
        if not env["SCRAPERAPI_KEY"]:
            _log("NOTE: SCRAPERAPI_KEY not set (retired 2026-08-07) — running direct-fetch")
        env = {k: v for k, v in env.items() if v}
        result = subprocess.run(cmd, cwd=str(BUYWHERE_API_DIR), env=env)
        sys.exit(result.returncode)


if __name__ == "__main__":
    main()
