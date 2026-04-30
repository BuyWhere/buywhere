#!/usr/bin/env python3
"""
Run the BuyWhere catalog freshness monitor once.

Expected cron:
0 * * * * cd /home/paperclip/buywhere-api && python scripts/catalog_freshness_monitor.py --once
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.product_freshness import run_catalog_freshness_monitor_once


def main() -> int:
    parser = argparse.ArgumentParser(description="Record catalog freshness snapshots and fire Paperclip alerts.")
    parser.add_argument("--once", action="store_true", help="Run one monitor cycle. Required for explicit cron use.")
    parser.add_argument("--alert-issue-id", help="Paperclip issue UUID to comment on when freshness alerts fire.")
    parser.add_argument("--data-dir", type=Path, help="Catalog data directory to scan for unprocessed NDJSON files.")
    args = parser.parse_args()

    if not args.once:
        parser.error("--once is required")

    report = asyncio.run(
        run_catalog_freshness_monitor_once(
            alert_issue_id=args.alert_issue_id,
            data_dir=args.data_dir,
        )
    )
    print(json.dumps(report, default=str, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
