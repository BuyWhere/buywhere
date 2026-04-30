"""Unit tests for Amazon SG scraper."""

import asyncio
from unittest.mock import AsyncMock

from scrapers.amazon_sg import AmazonSGScraper, CATEGORIES, MERCHANT_ID, SOURCE


SAMPLE_HTML = """
<html>
  <body>
    <div data-component-type="s-search-result" data-asin="B012345678">
      <h2>
        <a href="/Example-Product/dp/B012345678/ref=sr_1_1">
          <span>Example Wireless Headphones</span>
        </a>
      </h2>
      <img class="s-image" src="https://example.com/image.jpg" />
      <span class="a-price">
        <span class="a-offscreen">S$79.90</span>
      </span>
      <span class="a-text-price">
        <span class="a-offscreen">S$99.90</span>
      </span>
      <i class="a-icon a-icon-star-mini">
        <span class="a-icon-alt">4.4 out of 5 stars</span>
      </i>
      <a href="/Example-Product/dp/B012345678/ref=sr_1_1#customerReviews">
        <span>(128)</span>
      </a>
    </div>
    <a class="s-pagination-item s-pagination-next s-pagination-button" href="/s?page=2">Next</a>
  </body>
</html>
"""


class TestAmazonSGTransform:
    def setup_method(self):
        self.scraper = AmazonSGScraper(scrape_only=True)

    def test_transform_product_basic(self):
        raw = {
            "asin": "B012345678",
            "title": "Sony WH-1000XM5 Wireless Headphones",
            "url": "/Sony-WH-1000XM5/dp/B012345678",
            "price": "S$499.00",
            "original_price": "S$549.00",
            "image_url": "https://example.com/sony.jpg",
            "rating": "4.7 out of 5 stars",
            "review_count": "(2345)",
            "is_sponsored": True,
        }
        result = self.scraper.transform_product(raw, "Electronics", "headphones")

        assert result is not None
        assert result["sku"] == "B012345678"
        assert result["merchant_id"] == MERCHANT_ID
        assert result["title"] == "Sony WH-1000XM5 Wireless Headphones"
        assert result["price"] == 499.0
        assert result["currency"] == "SGD"
        assert result["url"] == "https://www.amazon.sg/Sony-WH-1000XM5/dp/B012345678"
        assert result["image_url"] == "https://example.com/sony.jpg"
        assert result["category"] == "Electronics"
        assert result["category_path"] == ["Electronics", "headphones"]
        assert result["brand"] == "Sony"
        assert result["is_active"] is True
        assert result["metadata"]["original_price"] == 549.0
        assert result["metadata"]["rating"] == 4.7
        assert result["metadata"]["review_count"] == 2345
        assert result["metadata"]["is_sponsored"] is True

    def test_transform_product_missing_asin_returns_none(self):
        result = self.scraper.transform_product({"title": "Missing asin"}, "Electronics", "laptop")
        assert result is None

    def test_parse_search_results(self):
        products, has_next_page = self.scraper.parse_search_results(
            SAMPLE_HTML, "Electronics", "headphones"
        )

        assert has_next_page is True
        assert len(products) == 1
        assert products[0]["sku"] == "B012345678"
        assert products[0]["title"] == "Example Wireless Headphones"
        assert products[0]["price"] == 79.9
        assert products[0]["metadata"]["original_price"] == 99.9
        assert products[0]["metadata"]["review_count"] == 128


class TestAmazonSGScraperInit:
    def test_default_values(self):
        scraper = AmazonSGScraper()
        assert scraper.api_key is None
        assert scraper.batch_size == 100
        assert scraper.delay == 1.5
        assert scraper.scrape_only is False
        assert scraper.output_dir.endswith("amazon_sg")
        assert scraper.max_pages_per_keyword == 25

    def test_custom_values(self):
        scraper = AmazonSGScraper(
            api_key="test-key",
            batch_size=50,
            delay=2.0,
            scrape_only=True,
            output_dir="/tmp/test-amazon",
            max_pages_per_keyword=5,
        )
        assert scraper.api_key == "test-key"
        assert scraper.batch_size == 50
        assert scraper.delay == 2.0
        assert scraper.scrape_only is True
        assert scraper.output_dir == "/tmp/test-amazon"
        assert scraper.max_pages_per_keyword == 5


class TestAmazonSGCategories:
    def test_categories_cover_task_scope(self):
        category_ids = [category["id"] for category in CATEGORIES]
        assert "electronics" in category_ids
        assert "home" in category_ids
        assert "fashion" in category_ids

    def test_categories_have_keywords(self):
        for category in CATEGORIES:
            assert category["keywords"]


class TestAmazonSGIngestBatch:
    def test_ingest_batch_scrape_only_writes_to_file(self):
        async def run_test():
            scraper = AmazonSGScraper(scrape_only=True, output_dir="/tmp/amazon_sg_test")
            scraper.client = AsyncMock()
            products = [
                {"sku": "A1", "title": "Item 1", "price": 10.0, "merchant_id": MERCHANT_ID},
                {"sku": "A2", "title": "Item 2", "price": 20.0, "merchant_id": MERCHANT_ID},
            ]
            inserted, updated, failed = await scraper.ingest_batch(products)
            assert inserted == 2
            assert updated == 0
            assert failed == 0

        asyncio.run(run_test())

    def test_ingest_batch_empty_returns_zeros(self):
        async def run_test():
            scraper = AmazonSGScraper(api_key="test", scrape_only=False)
            inserted, updated, failed = await scraper.ingest_batch([])
            assert inserted == 0
            assert updated == 0
            assert failed == 0

        asyncio.run(run_test())


def test_source_constant():
    assert SOURCE == "amazon_sg"
