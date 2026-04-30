import asyncio
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch


def test_catalog_health_router_exposes_freshness_monitor():
    async def run_test():
        from app.routers.catalog import catalog_health

        mock_health_data = {
            "generated_at": datetime.now(timezone.utc),
            "total_indexed": 1000,
            "by_platform": {"shopee_sg": 500},
            "compliance": {
                "total_products": 1000,
                "compliant_products": 950,
                "compliance_rate": 0.95,
                "by_platform": [],
                "missing_title": 0,
                "missing_price": 0,
                "missing_source": 0,
                "missing_source_id": 0,
                "missing_url": 0,
                "incomplete_products": 0,
            },
            "deduplication": {
                "total_products": 1000,
                "products_with_canonical": 100,
                "duplicate_rate": 0.1,
                "duplicate_groups": 10,
                "sample_duplicates": [],
            },
            "freshness": {
                "total_products": 1000,
                "stale_products": 25,
                "stale_rate": 2.5,
                "re_scrape_count": 25,
                "by_platform": {"shopee_sg": 25},
                "sample_stale": [],
            },
            "freshness_monitor": {
                "generated_at": datetime.now(timezone.utc),
                "source": "all",
                "flat_threshold_hours": 6,
                "min_product_count_change": 10,
                "latest_snapshot": {
                    "source": "all",
                    "product_count": 1000,
                    "snapshot_time": datetime.now(timezone.utc),
                    "hours_since": 0.1,
                },
                "trend": {
                    "trend": [],
                    "is_stale": False,
                    "hours_flat": 0.0,
                },
                "stalled_ingestion": None,
                "unprocessed_ndjson_files": [],
                "unprocessed_ndjson_count": 0,
            },
        }

        with patch("app.routers.catalog.get_catalog_health", new_callable=AsyncMock) as mock_get_health, \
             patch("app.routers.catalog.cache.cache_get", new_callable=AsyncMock) as mock_cache_get, \
             patch("app.routers.catalog.cache.cache_set", new_callable=AsyncMock) as mock_cache_set:
            mock_cache_get.return_value = None
            mock_get_health.return_value = mock_health_data
            result = await catalog_health(db=object(), api_key=object())

        assert result.freshness_monitor is not None
        assert result.freshness_monitor.flat_threshold_hours == 6
        mock_cache_set.assert_called_once()

    asyncio.run(run_test())
