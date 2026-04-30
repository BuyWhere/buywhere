import asyncio
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.services.catalog_quality import (
    compute_completeness_score,
    compute_freshness_score,
    compute_overall_score,
    compute_price_accuracy_score,
)


def test_compute_freshness_score_marks_stale_records():
    now = datetime(2026, 4, 16, tzinfo=timezone.utc)
    stale_time = now - timedelta(days=8)

    score, is_stale, age_days = compute_freshness_score(stale_time, now=now)

    assert score == 0.0
    assert is_stale is True
    assert age_days == 8


def test_compute_completeness_score_tracks_missing_fields():
    product = SimpleNamespace(
        title="AirPods Pro",
        description="",
        price=Decimal("299.00"),
        url="https://example.com/p/1",
        image_url=None,
        brand="Apple",
        category="Audio",
        sku="SKU-1",
    )

    score, missing = compute_completeness_score(product)

    assert score == 0.75
    assert missing == ["description", "image_url"]


def test_compute_price_accuracy_score_uses_recent_history_median():
    product = SimpleNamespace(price=Decimal("100.00"))

    score = compute_price_accuracy_score(product, [Decimal("95.00"), Decimal("100.00"), Decimal("105.00")])

    assert score == 1.0


def test_compute_overall_score_applies_weighting():
    score = compute_overall_score(
        freshness_score=0.5,
        completeness_score=0.8,
        price_accuracy_score=1.0,
    )

    assert score == 0.73


def test_catalog_quality_report_router(mock_db, mock_api_key):
    async def run_test():
        from app.routers.catalog import catalog_quality_report

        mock_report = {
            "generated_at": datetime.now(timezone.utc),
            "snapshot_date": datetime.now(timezone.utc).date(),
            "thresholds": {
                "stale_after_days": 7,
                "low_quality_score": 0.6,
                "price_history_lookback_days": 30,
            },
            "overview": {
                "total_products": 1000,
                "overall_quality_score": 0.84,
                "avg_freshness_score": 0.82,
                "avg_completeness_score": 0.88,
                "avg_price_accuracy_score": 0.81,
                "stale_products": 120,
                "stale_rate": 0.12,
                "field_completeness": {
                    "image_url_pct": 92.4,
                    "description_pct": 86.1,
                    "price_pct": 99.5,
                    "brand_pct": 71.3,
                },
            },
            "aggregates": {
                "by_source": [],
                "by_region": [],
                "by_category": [],
            },
            "re_scrape_recommendations": {
                "count": 1,
                "sources": [],
            },
            "stale_products": {
                "count": 120,
                "sample": [],
            },
            "low_quality_products": [],
        }

        with patch("app.routers.catalog.build_catalog_quality_report", new_callable=AsyncMock) as mock_builder:
            mock_builder.return_value = mock_report
            result = await catalog_quality_report(db=mock_db, api_key=mock_api_key)

        assert result.overview.total_products == 1000
        assert result.overview.field_completeness.price_pct == 99.5
        assert result.re_scrape_recommendations.count == 1

    asyncio.run(run_test())
