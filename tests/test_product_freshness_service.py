import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch


def test_check_for_stalled_ingestion_flags_flat_counts():
    async def run_test():
        from app.services.product_freshness import check_for_stalled_ingestion

        now = datetime(2026, 4, 23, 15, 0, tzinfo=timezone.utc)
        trend = {
            "trend": [
                {
                    "snapshot_time": now - timedelta(hours=6),
                    "product_count": 1000,
                    "hours_ago": 6.0,
                },
                {
                    "snapshot_time": now,
                    "product_count": 1004,
                    "hours_ago": 0.0,
                },
            ],
            "is_stale": True,
            "hours_flat": 6.0,
        }

        with patch("app.services.product_freshness.get_product_count_trend", new_callable=AsyncMock) as mock_trend:
            mock_trend.return_value = trend
            alert = await check_for_stalled_ingestion()

        assert alert is not None
        assert alert["type"] == "ingestion_stalled"
        assert alert["source"] == "all"
        assert alert["current_count"] == 1004

    asyncio.run(run_test())


def test_get_unprocessed_ndjson_files_detects_newer_file(tmp_path: Path):
    async def run_test():
        from app.services.product_freshness import get_unprocessed_ndjson_files

        platform_dir = tmp_path / "shopee"
        platform_dir.mkdir()
        ndjson_path = platform_dir / "products.ndjson"
        ndjson_path.write_text('{"id": 1}\n')

        with patch("app.services.product_freshness.get_latest_product_count", new_callable=AsyncMock) as mock_latest:
            mock_latest.return_value = {
                "source": "shopee",
                "product_count": 100,
                "snapshot_time": datetime.now(timezone.utc) - timedelta(hours=2),
                "hours_since": 2.0,
            }
            files = await get_unprocessed_ndjson_files(data_dir=tmp_path)

        assert len(files) == 1
        assert files[0]["platform"] == "shopee"
        assert files[0]["file_path"].endswith("products.ndjson")

    asyncio.run(run_test())


def test_build_catalog_freshness_monitor_report_includes_backlog():
    async def run_test():
        from app.services.product_freshness import build_catalog_freshness_monitor_report

        with patch("app.services.product_freshness.get_latest_product_count", new_callable=AsyncMock) as mock_latest, \
             patch("app.services.product_freshness.get_product_count_trend", new_callable=AsyncMock) as mock_trend, \
             patch("app.services.product_freshness.check_for_stalled_ingestion", new_callable=AsyncMock) as mock_stalled, \
             patch("app.services.product_freshness.get_unprocessed_ndjson_files", new_callable=AsyncMock) as mock_files:
            mock_latest.return_value = {
                "source": "all",
                "product_count": 1200,
                "snapshot_time": datetime.now(timezone.utc),
                "hours_since": 0.2,
            }
            mock_trend.return_value = {"trend": [], "is_stale": False, "hours_flat": 0.0}
            mock_stalled.return_value = None
            mock_files.return_value = [
                {
                    "platform": "lazada",
                    "file_path": "/tmp/lazada/file.ndjson",
                    "file_size_mb": 3.2,
                    "last_modified": datetime.now(timezone.utc),
                    "hours_since_scrape": 1.5,
                    "last_ingestion": None,
                }
            ]

            report = await build_catalog_freshness_monitor_report()

        assert report["source"] == "all"
        assert report["latest_snapshot"]["product_count"] == 1200
        assert report["unprocessed_ndjson_count"] == 1

    asyncio.run(run_test())
