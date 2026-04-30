"""Scraper health service stub."""
from datetime import datetime, timezone
from typing import Any, Dict


async def get_scraper_health(db=None) -> Dict[str, Any]:
    return {
        "generated_at": datetime.now(timezone.utc),
        "scrapers": [],
        "total_scrapers": 0,
        "healthy_count": 0,
        "unhealthy_count": 0,
    }