#!/usr/bin/env python3
"""
Carousell SG Continuous Scraper — runs the Carousell scraper 24/7.

This script wraps scrapers.carousell_sg and runs it in continuous mode,
refreshing every 4 hours as specified in the scraper_scheduler.

Usage:
    python -m scripts.carousell_continuous
    python -m scripts.carousell_continuous --scrape-only
"""

import os
import subprocess
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
VENV_PYTHON = PROJECT_ROOT / "venv" / "bin" / "python3"

API_KEY = os.environ.get("PRODUCT_API_KEY", os.environ.get("SCRAPERAPI_KEY", "dev-key"))
REFRESH_INTERVAL = 4 * 60 * 60  # 4 hours in seconds


def run_continuous():
    print(f"[carousell_continuous] Starting Carousell SG continuous scraper")
    print(f"[carousell_continuous] Refresh interval: {REFRESH_INTERVAL}s ({REFRESH_INTERVAL/3600:.1f}h)")
    print(f"[carousell_continuous] API key: {'*' * 8}{API_KEY[-4:] if len(API_KEY) > 4 else API_KEY}")

    consecutive_failures = 0
    max_failures = 5

    while True:
        try:
            print(f"\n[carousell_continuous] [{time.strftime('%Y-%m-%d %H:%M:%S')}] Starting scrape cycle...")

            result = subprocess.run(
                [
                    sys.executable if VENV_PYTHON.exists() else "python3",
                    "-m", "scrapers.carousell_sg",
                    "--api-key", API_KEY,
                    "--scrape-only",
                    "--batch-size", "500",
                    "--delay", "0.5",
                    "--products-per-category", "5000",
                ],
                cwd=str(PROJECT_ROOT),
                capture_output=False,
            )

            if result.returncode == 0:
                print(f"[carousell_continuous] Cycle completed successfully")
                consecutive_failures = 0
            else:
                print(f"[carousell_continuous] Cycle failed with exit code {result.returncode}")
                consecutive_failures += 1

            if consecutive_failures >= max_failures:
                print(f"[carousell_continuous] CRITICAL: {consecutive_failures} consecutive failures. Waiting 10min before retry...")
                time.sleep(600)
                consecutive_failures = 0
            else:
                print(f"[carousell_continuous] Sleeping {REFRESH_INTERVAL}s until next cycle...")
                time.sleep(REFRESH_INTERVAL)

        except KeyboardInterrupt:
            print(f"\n[carousell_continuous] Interrupted. Exiting.")
            break
        except Exception as e:
            print(f"[carousell_continuous] Unexpected error: {e}")
            consecutive_failures += 1
            time.sleep(60)


if __name__ == "__main__":
    run_continuous()