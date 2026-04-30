"""Unit tests for Myntra India scraper."""

import sys

sys.path.insert(0, "/home/paperclip/buywhere-api")

from scrapers.myntra_in import CATEGORIES, MERCHANT_ID, SOURCE, MyntraINScraper


class TestMyntraINTransform:
    def setup_method(self):
        self.scraper = MyntraINScraper(api_key="test-key", scrape_only=True)

    def test_transform_valid_product(self):
        raw = {
            "id": 12345678,
            "productName": "Roadster Men Printed T-shirt",
            "landingPageUrl": "tshirts/roadster/roadster-men-printed-t-shirt/12345678/buy",
            "searchImage": "https://assets.myntassets.com/image/upload/test.jpg",
            "brand": "Roadster",
            "price": 1299,
            "discountedPrice": 519,
            "rating": 4.3,
            "ratingCount": 1523,
            "gender": "Men",
            "baseColour": "Blue",
            "articleType": "Tshirts",
            "sizes": ["S", "M", "L"],
            "season": "Summer",
            "position": 7,
        }

        result = self.scraper.transform(raw, CATEGORIES[0])

        assert result is not None
        assert result["sku"] == "12345678"
        assert result["merchant_id"] == MERCHANT_ID
        assert result["title"] == "Roadster Men Printed T-shirt"
        assert result["price"] == 519.0
        assert result["currency"] == "INR"
        assert result["url"] == "https://www.myntra.com/tshirts/roadster/roadster-men-printed-t-shirt/12345678/buy"
        assert result["image_url"] == "https://assets.myntassets.com/image/upload/test.jpg"
        assert result["category"] == "Men"
        assert result["category_path"] == ["Men", "Tshirts"]
        assert result["brand"] == "Roadster"
        assert result["metadata"]["original_price"] == 1299.0
        assert result["metadata"]["discount_pct"] == 60
        assert result["metadata"]["rating"] == 4.3
        assert result["metadata"]["review_count"] == 1523
        assert result["metadata"]["sizes"] == ["S", "M", "L"]

    def test_transform_missing_url_returns_none(self):
        raw = {"id": 1, "productName": "Missing URL", "price": 999}
        assert self.scraper.transform(raw, CATEGORIES[0]) is None

    def test_transform_non_positive_price_returns_none(self):
        raw = {"id": 1, "productName": "Zero Price", "landingPageUrl": "/item/1", "price": 0}
        assert self.scraper.transform(raw, CATEGORIES[0]) is None


class TestMyntraINHelpers:
    def test_extract_products_from_payload_supports_multiple_shapes(self):
        payload = {"searchData": {"results": {"products": [{"id": 1}, {"id": 2}]}}}
        products = MyntraINScraper._extract_products_from_payload(payload)
        assert len(products) == 2
        assert products[0]["id"] == 1

    def test_detects_maintenance_html(self):
        assert MyntraINScraper._is_maintenance_response(
            "<html><title>Site Maintenance</title><h1>Oops! Something went wrong</h1></html>"
        )

    def test_parse_price_handles_inr_strings(self):
        assert MyntraINScraper._parse_price("Rs. 1,599") == 1599.0

    def test_normalize_product_url_accepts_relative_paths(self):
        assert (
            MyntraINScraper._normalize_product_url("shirts/brand/product/123/buy")
            == "https://www.myntra.com/shirts/brand/product/123/buy"
        )


def test_constants():
    assert SOURCE == "myntra_in"
    assert MERCHANT_ID == "myntra_in"
