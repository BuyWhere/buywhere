import sys
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

sys.path.insert(0, "/home/paperclip/buywhere-api")

from scrapers.bukalapak_id import BukalapakIDScraper, CATEGORIES, MERCHANT_ID, SOURCE


class TestBukalapakIDScraper:
    def setup_method(self):
        self.scraper = BukalapakIDScraper(
            api_key="test-key",
            api_base="http://localhost:8000",
            batch_size=10,
            delay=0.1,
        )

    def teardown_method(self):
        pass

    def test_transform_valid_product(self):
        raw = {
            "id": "123456",
            "name": "Samsung Galaxy S24 Ultra",
            "price": "Rp 15.000.000",
            "original_price": "Rp 20.000.000",
            "discount_percentage": "25%",
            "images": ["https://images.bukalapak.com/image1.jpg"],
            "url": "https://www.bukalapak.com/products/samsung-galaxy-s24-ultra",
            "brand": "Samsung",
            "rating": 4.9,
            "review_count": 1000,
            "shop": {"name": "Samsung Official Store"},
            "location": "Jakarta",
        }
        category = CATEGORIES[0]

        result = self.scraper._transform_bukalapak_product(raw, category)

        assert result is not None
        assert result["sku"] == "bukalapak_123456"
        assert result["merchant_id"] == MERCHANT_ID
        assert result["source"] == SOURCE
        assert result["title"] == "Samsung Galaxy S24 Ultra"
        assert result["price"] == 15000000.0
        assert result["currency"] == "IDR"
        assert result["url"] == "https://www.bukalapak.com/products/samsung-galaxy-s24-ultra"
        assert result["image_url"] == "https://images.bukalapak.com/image1.jpg"
        assert result["brand"] == "Samsung"
        assert result["is_active"] is True
        assert result["metadata"]["original_price"] == 20000000.0
        assert result["metadata"]["discount_pct"] == 25
        assert result["metadata"]["rating"] == 4.9
        assert result["metadata"]["review_count"] == 1000
        assert result["metadata"]["seller_name"] == "Samsung Official Store"
        assert result["metadata"]["location"] == "Jakarta"
        assert result["metadata"]["country"] == "ID"

    def test_transform_missing_sku_returns_none(self):
        raw = {
            "name": "Product without ID",
            "price": 10000,
        }
        category = CATEGORIES[0]

        result = self.scraper._transform_bukalapak_product(raw, category)

        assert result is None

    def test_transform_missing_name_returns_none(self):
        raw = {
            "id": "123",
            "price": 10000,
        }
        category = CATEGORIES[0]

        result = self.scraper._transform_bukalapak_product(raw, category)

        assert result is None

    def test_transform_price_parsing(self):
        test_cases = [
            ("Rp 15.000.000", 15000000.0),
            ("15000000", 15000000.0),
            (15000000, 15000000.0),
            (15000000.0, 15000000.0),
        ]
        category = CATEGORIES[0]

        for price_input, expected in test_cases:
            raw = {
                "id": "123",
                "name": "Test Product",
                "price": price_input,
            }
            result = self.scraper._transform_bukalapak_product(raw, category)
            assert result is not None, f"Failed for price input: {price_input}"
            assert result["price"] == expected, f"Failed for price input: {price_input}"

    def test_transform_url_normalization(self):
        raw = {
            "id": "123",
            "name": "Test Product",
            "price": 10000,
            "url": "/product/test-product",
        }
        category = CATEGORIES[0]

        result = self.scraper._transform_bukalapak_product(raw, category)

        assert result["url"] == "https://www.bukalapak.com/product/test-product"

    def test_transform_url_already_absolute(self):
        raw = {
            "id": "123",
            "name": "Test Product",
            "price": 10000,
            "url": "https://www.bukalapak.com/products/test-product",
        }
        category = CATEGORIES[0]

        result = self.scraper._transform_bukalapak_product(raw, category)

        assert result["url"] == "https://www.bukalapak.com/products/test-product"

    def test_transform_image_extraction_from_list(self):
        raw = {
            "id": "123",
            "name": "Test Product",
            "price": 10000,
            "images": [
                "https://images.bukalapak.com/img1.jpg",
                "https://images.bukalapak.com/img2.jpg",
            ],
        }
        category = CATEGORIES[0]

        result = self.scraper._transform_bukalapak_product(raw, category)

        assert result["image_url"] == "https://images.bukalapak.com/img1.jpg"

    def test_transform_image_extraction_from_string(self):
        raw = {
            "id": "123",
            "name": "Test Product",
            "price": 10000,
            "images": "https://images.bukalapak.com/img1.jpg",
        }
        category = CATEGORIES[0]

        result = self.scraper._transform_bukalapak_product(raw, category)

        assert result["image_url"] == "https://images.bukalapak.com/img1.jpg"

    def test_transform_category_fields(self):
        raw = {
            "id": "123",
            "name": "Test Product",
            "price": 10000,
        }
        category = {"name": "Electronics", "sub": "Phones", "id": "phones", "url": "https://bukalapak.com/phones"}

        result = self.scraper._transform_bukalapak_product(raw, category)

        assert result["category"] == "Electronics"
        assert result["category_path"] == ["Electronics", "Phones"]
        assert result["metadata"]["subcategory"] == "Phones"

    def test_transform_discount_parsing(self):
        raw = {
            "id": "123",
            "name": "Test Product",
            "price": 10000,
            "discount_percentage": "25%",
        }
        category = CATEGORIES[0]

        result = self.scraper._transform_bukalapak_product(raw, category)

        assert result["metadata"]["discount_pct"] == 25

    def test_transform_seller_from_shop_dict(self):
        raw = {
            "id": "123",
            "name": "Test Product",
            "price": 10000,
            "shop": {"name": "Official Store"},
        }
        category = CATEGORIES[0]

        result = self.scraper._transform_bukalapak_product(raw, category)

        assert result["metadata"]["seller_name"] == "Official Store"

    def test_transform_seller_from_seller_dict(self):
        raw = {
            "id": "123",
            "name": "Test Product",
            "price": 10000,
            "seller": {"name": "Direct Seller"},
        }
        category = CATEGORIES[0]

        result = self.scraper._transform_bukalapak_product(raw, category)

        assert result["metadata"]["seller_name"] == "Direct Seller"

    def test_transform_location(self):
        raw = {
            "id": "123",
            "name": "Test Product",
            "price": 10000,
            "location": "Jakarta",
        }
        category = CATEGORIES[0]

        result = self.scraper._transform_bukalapak_product(raw, category)

        assert result["metadata"]["location"] == "Jakarta"

    def test_transform_condition_and_seller_rating(self):
        raw = {
            "id": "123",
            "name": "Test Product",
            "price": 10000,
            "condition": "new",
            "shop": {
                "name": "Official Store",
                "rating": 4.8,
            },
        }
        category = CATEGORIES[0]

        result = self.scraper._transform_bukalapak_product(raw, category)

        assert result["metadata"]["condition"] == "new"
        assert result["metadata"]["seller_rating"] == 4.8

    def test_transform_location_from_city(self):
        raw = {
            "id": "123",
            "name": "Test Product",
            "price": 10000,
            "city": "Bandung",
        }
        category = CATEGORIES[0]

        result = self.scraper._transform_bukalapak_product(raw, category)

        assert result["metadata"]["location"] == "Bandung"

    def test_transform_exception_returns_none(self):
        raw = {"invalid": "data"}
        category = CATEGORIES[0]

        result = self.scraper._transform_bukalapak_product(raw, category)

        assert result is None

    def test_transform_with_product_id_field(self):
        raw = {
            "product_id": "789",
            "name": "Test Product",
            "price": 50000,
        }
        category = CATEGORIES[0]

        result = self.scraper._transform_bukalapak_product(raw, category)

        assert result is not None
        assert result["sku"] == "bukalapak_789"

    def test_transform_with_sku_field(self):
        raw = {
            "sku": "SKU-123",
            "name": "Test Product",
            "price": 50000,
        }
        category = CATEGORIES[0]

        result = self.scraper._transform_bukalapak_product(raw, category)

        assert result is not None
        assert result["sku"] == "bukalapak_SKU-123"

    def test_get_category_id_mapping(self):
        assert self.scraper._get_category_id("hp-smartphone") == "142"
        assert self.scraper._get_category_id("laptop") == "144"
        assert self.scraper._get_category_id("tv") == "146"
        assert self.scraper._get_category_id("fashion-wanita") == "66"
        assert self.scraper._get_category_id("furniture") == "89"

    def test_get_category_id_unknown_returns_input(self):
        assert self.scraper._get_category_id("unknown-cat") == "unknown-cat"

    def test_detects_not_found_shell_response(self):
        html = '{"statusCode":404,"message":"Page not found: /products?page=1&search[category_id]=142"}'
        assert self.scraper._looks_like_not_found_shell(
            html,
            "https://www.bukalapak.com/products?page=1&search%5Bcategory_id%5D=142",
        ) is True

    def test_detects_html_404_shell_without_literal_page_not_found(self):
        html = "<!DOCTYPE html><html data-capo><head><script>window.APP = {}</script></head></html>"
        assert self.scraper._looks_like_not_found_shell(
            html,
            "https://www.bukalapak.com/products?page=1&search%5Bcategory_id%5D=142",
            status_code=404,
        ) is True

    def test_detects_search_route_html_404_shell(self):
        html = "<!DOCTYPE html><html data-capo><head><script>window.APP = {}</script></head></html>"
        assert self.scraper._looks_like_not_found_shell(
            html,
            "https://www.bukalapak.com/search?q=samsung",
            status_code=404,
        ) is True

    @pytest.mark.asyncio
    async def test_marks_catalog_unavailable_on_proxy_timeout(self):
        scraper = BukalapakIDScraper(
            api_key="test-key",
            scrape_only=True,
            proxy_url="http://proxy.local:8001",
        )
        try:
            scraper.client.get = AsyncMock(side_effect=httpx.ReadTimeout("timed out"))
            products = await scraper.fetch_products_page(CATEGORIES[0], 1)
            assert products == []
            assert scraper.catalog_surface_unavailable is True
            assert "timed out" in scraper.catalog_surface_reason.lower()
        finally:
            await scraper.close()

    def test_builds_scraperapi_proxy_url(self):
        scraper = BukalapakIDScraper(
            api_key="test-key",
            scraperapi_key="abc123",
        )
        assert scraper.proxy_url == "http://scraperapi:abc123@proxy-server.scraperapi.com:8001"


class TestBukalapakIDScraperOutputSchema:
    def setup_method(self):
        self.scraper = BukalapakIDScraper(
            api_key="test-key",
            api_base="http://localhost:8000",
            batch_size=10,
            delay=0.1,
        )

    def test_output_matches_ingest_schema(self):
        from app.schemas.ingest import IngestProductItem

        raw = {
            "id": "123456",
            "name": "Samsung Galaxy S24",
            "price": 15000000.0,
            "original_price": 20000000.0,
            "discount_percentage": "25%",
            "images": ["https://images.bukalapak.com/image1.jpg"],
            "url": "https://www.bukalapak.com/products/samsung-galaxy-s24",
            "brand": "Samsung",
            "rating": 4.9,
            "review_count": 1000,
            "shop": {"name": "Samsung Store"},
            "location": "Jakarta",
        }
        category = CATEGORIES[0]
        transformed = self.scraper._transform_bukalapak_product(raw, category)

        assert transformed is not None
        item = IngestProductItem(**transformed)
        assert item.sku == "bukalapak_123456"
        assert item.merchant_id == "bukalapak_id"
        assert item.title == "Samsung Galaxy S24"
        assert item.price == Decimal("15000000.00")
        assert item.currency == "IDR"
        assert item.url == "https://www.bukalapak.com/products/samsung-galaxy-s24"
        assert item.brand == "Samsung"


class TestBukalapakIDCategories:
    def test_categories_defined(self):
        assert len(CATEGORIES) > 0
        for cat in CATEGORIES:
            assert "id" in cat
            assert "name" in cat
            assert "sub" in cat
            assert "url" in cat

    def test_electronics_categories(self):
        electronics_cats = [c for c in CATEGORIES if c["name"] == "Electronics"]
        assert len(electronics_cats) >= 5

    def test_fashion_categories(self):
        fashion_cats = [c for c in CATEGORIES if c["name"] == "Fashion"]
        assert len(fashion_cats) >= 4

    def test_home_and_living_categories(self):
        home_cats = [c for c in CATEGORIES if c["name"] == "Home & Living"]
        assert len(home_cats) >= 4

    def test_beauty_and_health_categories(self):
        health_cats = [c for c in CATEGORIES if c["name"] == "Beauty & Health"]
        assert len(health_cats) >= 4

    def test_all_category_ids_mapped(self):
        for cat in CATEGORIES:
            mapped_id = BukalapakIDScraper._get_category_id(None, cat["id"])
            assert mapped_id is not None


class TestBukalapakIDScraperIngestion:
    def setup_method(self):
        self.scraper = BukalapakIDScraper(
            api_key="test-key",
            api_base="http://localhost:8000",
            batch_size=10,
            delay=0.1,
        )

    @pytest.mark.asyncio
    async def test_ingest_batch_success(self):
        products = [
            {
                "sku": "bukalapak_123",
                "merchant_id": "bukalapak_id",
                "title": "Test Product",
                "price": 10000.0,
                "currency": "IDR",
                "url": "https://example.com",
                "image_url": "",
                "category": "Test",
                "category_path": ["Test"],
                "brand": "Test",
                "is_active": True,
            }
        ]

        mock_response = MagicMock()
        mock_response.json.return_value = {"rows_inserted": 1, "rows_updated": 0, "rows_failed": 0}
        mock_response.raise_for_status = MagicMock()

        mock_post = AsyncMock(return_value=mock_response)
        with patch.object(self.scraper.client, 'post', mock_post):
            inserted, updated, failed = await self.scraper.ingest_batch(products)
            assert inserted == 1
            assert updated == 0
            assert failed == 0

    @pytest.mark.asyncio
    async def test_ingest_batch_empty_returns_zeros(self):
        inserted, updated, failed = await self.scraper.ingest_batch([])
        assert inserted == 0
        assert updated == 0
        assert failed == 0

    @pytest.mark.asyncio
    async def test_ingest_batch_failure_returns_full_count(self):
        products = [
            {
                "sku": "bukalapak_123",
                "merchant_id": "bukalapak_id",
                "title": "Test Product",
                "price": 10000.0,
                "currency": "IDR",
                "url": "https://example.com",
                "image_url": "",
                "category": "Test",
                "category_path": ["Test"],
                "brand": "Test",
                "is_active": True,
            }
        ]

        with patch.object(self.scraper.client, 'post', side_effect=Exception("API Error")):
            inserted, updated, failed = await self.scraper.ingest_batch(products)
            assert inserted == 0
            assert updated == 0
            assert failed == 1


class TestBukalapakIDScraperRunBehavior:
    @pytest.mark.asyncio
    async def test_run_stops_early_when_catalog_surface_unavailable(self):
        scraper = BukalapakIDScraper(
            api_key="test-key",
            batch_size=10,
            delay=0.0,
            max_pages_per_category=1,
            target_products=10,
        )

        async def fake_fetch(category, page):
            scraper.catalog_surface_unavailable = True
            scraper.catalog_surface_reason = "Bukalapak listing routes are returning a 404 shell page instead of catalog data."
            return []

        with patch.object(scraper, "fetch_products_page", side_effect=fake_fetch):
            summary = await scraper.run()

        assert summary["catalog_surface_unavailable"] is True
        assert "blocked_reason" in summary
        await scraper.close()
