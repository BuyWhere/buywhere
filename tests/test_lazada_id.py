import sys
from decimal import Decimal

sys.path.insert(0, "/home/paperclip/buywhere-api")

from app.schemas.ingest import IngestProductItem
from scrapers.lazada_id import CATEGORIES, MERCHANT_ID, SOURCE, LazadaIDScraper


class TestLazadaIDTransform:
    def setup_method(self):
        self.scraper = LazadaIDScraper(
            api_key="test-key",
            api_base="http://localhost:8000",
            batch_size=10,
            delay=0.1,
            scrape_only=True,
        )

    def test_transform_valid_list_item_shape(self):
        raw = {
            "itemId": "123456",
            "name": "Apple iPhone 15 Pro Max 256GB",
            "price": "Rp17.999.000",
            "originalPrice": "Rp21.999.000",
            "discount": "-18%",
            "image": "//img.lazcdn.com/test.jpg",
            "itemUrl": "//www.lazada.co.id/products/apple-iphone-15-pro-max-i123456.html",
            "brandName": "Apple",
            "ratingScore": "4.8",
            "review": 913,
            "sellerName": "Apple Flagship Store",
            "location": "Jakarta",
            "categoryId": "10000340",
        }

        result = self.scraper._transform_lazada_product(raw, CATEGORIES[0])

        assert result is not None
        assert result["sku"] == "lazada_id_123456"
        assert result["merchant_id"] == MERCHANT_ID
        assert result["source"] == SOURCE
        assert result["title"] == "Apple iPhone 15 Pro Max 256GB"
        assert result["price"] == 17999000.0
        assert result["currency"] == "IDR"
        assert result["region"] == "id"
        assert result["country_code"] == "ID"
        assert result["url"] == "https://www.lazada.co.id/products/apple-iphone-15-pro-max-i123456.html"
        assert result["image_url"] == "https://img.lazcdn.com/test.jpg"
        assert result["brand"] == "Apple"
        assert result["metadata"]["seller_name"] == "Apple Flagship Store"
        assert result["metadata"]["country"] == "ID"
        assert result["metadata"]["cross_listing_ids"]["tokopedia_lookup"].startswith("tpd:apple:")

    def test_transform_supports_price_show_fallback(self):
        raw = {
            "itemId": "222",
            "name": "Xiaomi Redmi Note 13",
            "priceShow": "Rp 2.499.000",
            "originalPriceShow": "Rp 2.799.000",
            "imageUrl": "https://img.lazcdn.com/redmi.jpg",
            "productUrl": "/products/redmi-note-13-i222.html",
        }

        result = self.scraper._transform_lazada_product(raw, CATEGORIES[0])

        assert result is not None
        assert result["price"] == 2499000.0
        assert result["metadata"]["original_price"] == 2799000.0

    def test_transform_missing_url_returns_none(self):
        raw = {"itemId": "1", "name": "Missing URL", "price": "Rp 10.000"}
        assert self.scraper._transform_lazada_product(raw, CATEGORIES[0]) is None

    def test_transform_non_positive_price_returns_none(self):
        raw = {
            "itemId": "1",
            "name": "Zero Price",
            "price": 0,
            "productUrl": "/products/zero-price.html",
        }
        assert self.scraper._transform_lazada_product(raw, CATEGORIES[0]) is None

    def test_output_matches_ingest_schema(self):
        raw = {
            "productId": "555",
            "name": "Samsung Galaxy S24",
            "price": "Rp 15.499.000",
            "originalPrice": "Rp 16.999.000",
            "imageUrl": "https://img.lazcdn.com/s24.jpg",
            "productUrl": "/products/samsung-galaxy-s24-i555.html",
            "brandName": "Samsung",
        }

        transformed = self.scraper._transform_lazada_product(raw, CATEGORIES[0])
        assert transformed is not None

        item = IngestProductItem(**transformed)
        assert item.sku == "lazada_id_555"
        assert item.merchant_id == "lazada_id"
        assert item.price == Decimal("15499000.00")
        assert item.region == "id"
        assert item.country_code == "ID"


class TestLazadaIDHelpers:
    def test_extract_products_from_multiple_payload_shapes(self):
        scraper = LazadaIDScraper(api_key="test-key", scrape_only=True)
        category = CATEGORIES[0]
        payload = {
            "mods": {
                "listItems": [
                    {
                        "itemId": "777",
                        "name": "Sony WH-1000XM5",
                        "price": "Rp 5.999.000",
                        "image": "https://img.lazcdn.com/sony.jpg",
                        "itemUrl": "/products/sony-wh1000xm5-i777.html",
                        "brandName": "Sony",
                    }
                ]
            }
        }

        products = scraper._extract_products_from_response(payload, category)

        assert len(products) == 1
        assert products[0]["sku"] == "lazada_id_777"
        assert products[0]["title"] == "Sony WH-1000XM5"

    def test_build_cross_listing_ids_strips_brand_prefix(self):
        keys = LazadaIDScraper._build_cross_listing_ids("Apple iPhone 15 Pro Max 256GB", "Apple")
        assert keys["tokopedia_lookup"] == "tpd:apple:iphone-15-pro-max-256gb"
        assert keys["catalog_dedupe"] == "dedupe:apple:iphone-15-pro-max-256gb"

    def test_enrich_playwright_product_sets_category_and_region(self):
        scraper = LazadaIDScraper(api_key="test-key", scrape_only=True)
        product = {
            "sku": "lazada_id_hash123",
            "merchant_id": "lazada_id",
            "title": "Sample Product",
            "description": "",
            "price": 10000.0,
            "currency": "IDR",
            "url": "https://www.lazada.co.id/catalog/?q=sample",
            "image_url": "https://img.lazcdn.com/sample.jpg",
            "category": "",
            "category_path": [],
            "brand": "",
            "is_active": True,
            "metadata": {},
        }

        enriched = scraper._enrich_playwright_product(product, CATEGORIES[0])

        assert enriched["category"] == "Electronics"
        assert enriched["category_path"] == ["Electronics", "Phones"]
        assert enriched["region"] == "id"
        assert enriched["country_code"] == "ID"
        assert enriched["metadata"]["cross_listing_ids"]["catalog_dedupe"].startswith("dedupe:")
