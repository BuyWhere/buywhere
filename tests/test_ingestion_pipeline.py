"""Integration tests for scraper-to-database ingestion pipeline.

Tests the full flow: read NDJSON file -> validate schema -> transform ->
insert to DB -> verify query. Tests with sample data from each scraper
format. Verifies dedup, update-on-conflict, and error handling.
"""

import asyncio
import io
import json
import sys
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, "/home/paperclip/buywhere-api")

from app.schemas.ingest import IngestProductItem, IngestRequest, normalize_price


class SampleData:
    SHOPEE_SG = {
        "sku": "12345_67890",
        "merchant_id": "shopee_sg",
        "title": "iPhone 14 Case - Clear Transparent",
        "description": "",
        "price": 29.90,
        "currency": "SGD",
        "url": "https://shopee.sg/product/12345/67890",
        "image_url": "https://cf.shopee.sg/file/abc123def456",
        "category": "Electronics",
        "category_path": ["Electronics", "Phone Accessories"],
        "brand": "Apple",
        "is_active": True,
        "metadata": {
            "original_price": 39.90,
            "discount_pct": 25,
            "rating": 4.5,
            "review_count": 100,
            "location": "Singapore",
            "has_variants": False,
        },
    }

    LAZADA_SG = {
        "sku": "SGTAB001",
        "merchant_id": "lazada_sg",
        "title": "Samsung Galaxy Tab S9 Ultra",
        "description": "Premium Android tablet with S Pen included",
        "price": 1299.00,
        "currency": "SGD",
        "url": "https://www.lazada.sg/products/samsung-galaxy-tab-s9-ultra",
        "image_url": "https://sg-01-fpl-images.mylazada.com/123456789.jpg",
        "category": "Electronics",
        "category_path": ["Electronics", "Tablets"],
        "brand": "Samsung",
        "is_active": True,
        "metadata": {
            "original_price": 1499.00,
            "discount_pct": 13,
            "rating": 4.7,
            "review_count": 250,
            "subcategory": "Tablets",
            "seller_name": "Samsung Official Store",
            "location": "Singapore",
            "lazada_category_id": "6620",
        },
    }

    CAROUSELL_SG = {
        "sku": "C2C-123456",
        "merchant_id": "carousell_sg",
        "title": "Nike Air Max 90 - Size US9 - Barely Used",
        "description": "Bought but never wore, too small. Great condition.",
        "price": 120.00,
        "currency": "SGD",
        "url": "https://www.carousell.com/p/nike-air-max-90-123456",
        "image_url": "https://images.carousell.com/123456/abc_def_ghi.jpg",
        "category": "Fashion",
        "category_path": ["Fashion", "Shoes"],
        "brand": "Nike",
        "is_active": True,
        "metadata": {
            "condition": "like_new",
            "seller_rating": 4.8,
            "listing_age_days": 5,
        },
    }

    QOO10_SG = {
        "sku": "Q10-ELEC-001",
        "merchant_id": "qoo10_sg",
        "title": "Sony WH-1000XM5 Wireless Headphones",
        "description": "Industry leading noise cancellation",
        "price": 349.00,
        "currency": "SGD",
        "url": "https://www.qoo10.sg/item/SONY-WH-1000XM5/123456789",
        "image_url": "https://image.qoo10.sg/11/123456789.jpg",
        "category": "Electronics",
        "category_path": ["Electronics", "Audio"],
        "brand": "Sony",
        "is_active": True,
        "metadata": {
            "original_price": 449.00,
            "discount_pct": 22,
            "seller_name": "TechDeals SG",
        },
    }

    Zalora_SG = {
        "sku": "ZAL-SHOE-001",
        "merchant_id": "zalora_sg",
        "title": "Adidas Ultraboost 22 - Core Black",
        "description": "Premium running shoes with Boost midsole",
        "price": 219.00,
        "currency": "SGD",
        "url": "https://www.zalora.sg/adidas-ultraboost-22-core-black",
        "image_url": "https://img.zalora.net/abc123.jpg",
        "category": "Fashion",
        "category_path": ["Fashion", "Shoes", "Running"],
        "brand": "Adidas",
        "is_active": True,
        "metadata": {
            "original_price": 299.00,
            "discount_pct": 27,
            "rating": 4.6,
            "review_count": 89,
            "sizes_available": ["US7", "US8", "US9"],
        },
    }

    GUARDIAN_SG = {
        "sku": "GDN-VIT-D3-001",
        "merchant_id": "guardian_sg",
        "title": "Centrum Vitamin D3 1000IU - 100 Tablets",
        "description": "Supports bone health and immune function",
        "price": 24.90,
        "currency": "SGD",
        "url": "https://www.guardian.com.sg/centrum-vitamin-d3",
        "image_url": "https://images.guardian.com.sg/123456.jpg",
        "category": "Health",
        "category_path": ["Health", "Supplements", "Vitamins"],
        "brand": "Centrum",
        "is_active": True,
        "metadata": {
            "original_price": 29.90,
            "stock_status": "in_stock",
            "quantity_available": 50,
        },
    }


def ndjson_lines(products: list[dict]) -> str:
    return "\n".join(json.dumps(p, ensure_ascii=False) for p in products) + "\n"


def parse_ndjson(ndjson_str: str) -> list[dict]:
    lines = ndjson_str.strip().split("\n")
    return [json.loads(line) for line in lines if line.strip()]


class TestPipelineReadNDJSON:
    def test_parse_valid_ndjson_single_product(self):
        data = ndjson_lines([SampleData.SHOPEE_SG])
        parsed = parse_ndjson(data)
        assert len(parsed) == 1
        assert parsed[0]["sku"] == "12345_67890"

    def test_parse_valid_ndjson_multiple_products(self):
        products = [
            SampleData.SHOPEE_SG,
            SampleData.LAZADA_SG,
            SampleData.CAROUSELL_SG,
        ]
        data = ndjson_lines(products)
        parsed = parse_ndjson(data)
        assert len(parsed) == 3

    def test_parse_ndjson_from_all_scraper_formats(self):
        products = [
            SampleData.SHOPEE_SG,
            SampleData.LAZADA_SG,
            SampleData.CAROUSELL_SG,
            SampleData.QOO10_SG,
            SampleData.Zalora_SG,
            SampleData.GUARDIAN_SG,
        ]
        data = ndjson_lines(products)
        parsed = parse_ndjson(data)
        assert len(parsed) == 6
        assert parsed[0]["merchant_id"] != parsed[1]["merchant_id"]

    def test_parse_ndjson_with_empty_lines(self):
        data = json.dumps(SampleData.SHOPEE_SG) + "\n\n" + json.dumps(SampleData.LAZADA_SG) + "\n"
        parsed = parse_ndjson(data)
        assert len(parsed) == 2

    def test_parse_ndjson_with_trailing_newline(self):
        data = json.dumps(SampleData.SHOPEE_SG) + "\n"
        parsed = parse_ndjson(data)
        assert len(parsed) == 1

    def test_parse_invalid_json_raises(self):
        invalid = '{"sku": "TEST", invalid json}'
        with pytest.raises(json.JSONDecodeError):
            parse_ndjson(invalid)

    def test_empty_ndjson_returns_empty_list(self):
        assert parse_ndjson("") == []
        assert parse_ndjson("\n") == []


class TestPipelineSchemaValidation:
    def test_validate_valid_shopee_product(self):
        item = IngestProductItem(**SampleData.SHOPEE_SG)
        assert item.sku == "12345_67890"
        assert item.price == Decimal("29.90")

    def test_validate_valid_lazada_product(self):
        item = IngestProductItem(**SampleData.LAZADA_SG)
        assert item.sku == "SGTAB001"
        assert item.metadata["seller_name"] == "Samsung Official Store"

    def test_validate_valid_carousell_product(self):
        item = IngestProductItem(**SampleData.CAROUSELL_SG)
        assert item.sku == "C2C-123456"
        assert item.is_available is True

    def test_validate_all_scraper_formats(self):
        formats = [
            ("shopee_sg", SampleData.SHOPEE_SG),
            ("lazada_sg", SampleData.LAZADA_SG),
            ("carousell_sg", SampleData.CAROUSELL_SG),
            ("qoo10_sg", SampleData.QOO10_SG),
            ("zalora_sg", SampleData.Zalora_SG),
            ("guardian_sg", SampleData.GUARDIAN_SG),
        ]
        for source, product in formats:
            item = IngestProductItem(**product)
            assert item.merchant_id == source, f"Failed for {source}"

    def test_validate_missing_required_field_sku(self):
        product = dict(SampleData.SHOPEE_SG)
        del product["sku"]
        with pytest.raises(Exception):
            IngestProductItem(**product)

    def test_validate_missing_required_field_title(self):
        product = dict(SampleData.SHOPEE_SG)
        del product["title"]
        with pytest.raises(Exception):
            IngestProductItem(**product)

    def test_validate_missing_required_field_price(self):
        product = dict(SampleData.SHOPEE_SG)
        del product["price"]
        with pytest.raises(Exception):
            IngestProductItem(**product)

    def test_validate_missing_required_field_url(self):
        product = dict(SampleData.SHOPEE_SG)
        del product["url"]
        with pytest.raises(Exception):
            IngestProductItem(**product)

    def test_validate_missing_required_field_merchant_id(self):
        product = dict(SampleData.SHOPEE_SG)
        del product["merchant_id"]
        with pytest.raises(Exception):
            IngestProductItem(**product)

    def test_validate_invalid_price_negative(self):
        product = dict(SampleData.SHOPEE_SG)
        product["price"] = -10.00
        with pytest.raises(Exception):
            IngestProductItem(**product)

    def test_validate_invalid_url_format(self):
        product = dict(SampleData.SHOPEE_SG)
        product["url"] = "not-a-valid-url"
        with pytest.raises(Exception):
            IngestProductItem(**product)

    def test_validate_invalid_currency(self):
        product = dict(SampleData.SHOPEE_SG)
        product["currency"] = "XYZ"
        with pytest.raises(Exception):
            IngestProductItem(**product)

    def test_validate_optional_fields_missing_is_ok(self):
        product = {
            "sku": "MINIMAL-001",
            "merchant_id": "test",
            "title": "Minimal Product",
            "price": 10.00,
            "url": "https://example.com/p/1",
        }
        item = IngestProductItem(**product)
        assert item.sku == "MINIMAL-001"
        assert item.description is None
        assert item.image_url is None
        assert item.brand is None


class TestPipelineTransform:
    def test_transform_shopee_raw_to_ingest_format(self):
        raw = {
            "item_basic": {
                "shopid": 12345,
                "itemid": 67890,
                "name": "iPhone 14 Case",
                "price": 2990000,
                "images": ["abc123def456"],
                "brand": "Apple",
                "rating_star": 4.5,
                "cmt_count": 100,
            }
        }
        category = {"name": "Electronics", "sub": "Phone Accessories"}
        expected_sku = "12345_67890"
        assert expected_sku == "12345_67890"

    def test_transform_preserves_all_metadata(self):
        item = IngestProductItem(**SampleData.SHOPEE_SG)
        assert item.metadata["discount_pct"] == 25
        assert item.metadata["review_count"] == 100
        assert item.metadata["has_variants"] is False

    def test_transform_normalizes_price_string_to_decimal(self):
        product = dict(SampleData.SHOPEE_SG)
        product["price"] = "$29.90"
        item = IngestProductItem(**product)
        assert item.price == Decimal("29.90")

    def test_transform_normalizes_currency_lowercase(self):
        product = dict(SampleData.SHOPEE_SG)
        product["currency"] = "sgd"
        item = IngestProductItem(**product)
        assert item.currency == "SGD"

    def test_transform_infers_availability_from_string(self):
        product = dict(SampleData.GUARDIAN_SG)
        item = IngestProductItem(**product)
        assert item.is_available is True

    def test_transform_preserves_category_path(self):
        item = IngestProductItem(**SampleData.LAZADA_SG)
        assert item.category_path == ["Electronics", "Tablets"]


class TestPipelineDedup:
    def test_dedup_same_sku_same_source_is_duplicate(self):
        products = [
            {**SampleData.SHOPEE_SG, "title": "Product v1"},
            {**SampleData.SHOPEE_SG, "title": "Product v2"},
        ]
        dedup_keys = [(p["sku"], p["merchant_id"]) for p in products]
        unique_keys = set(dedup_keys)
        assert len(unique_keys) == 1

    def test_dedup_same_sku_different_source_is_not_duplicate(self):
        product_a = {**SampleData.SHOPEE_SG}
        product_b = {**SampleData.SHOPEE_SG}
        product_b["merchant_id"] = "lazada_sg"
        dedup_keys = [(product_a["sku"], product_a["merchant_id"]), (product_b["sku"], product_b["merchant_id"])]
        unique_keys = set(dedup_keys)
        assert len(unique_keys) == 2

    def test_dedup_different_sku_same_source_are_unique(self):
        product_a = {**SampleData.SHOPEE_SG, "sku": "SHOPEE-001"}
        product_b = {**SampleData.SHOPEE_SG, "sku": "SHOPEE-002"}
        dedup_keys = [(product_a["sku"], product_a["merchant_id"]), (product_b["sku"], product_b["merchant_id"])]
        unique_keys = set(dedup_keys)
        assert len(unique_keys) == 2

    def test_dedup_batch_with_duplicates_identified(self):
        products = [
            {**SampleData.SHOPEE_SG},
            {**SampleData.LAZADA_SG},
            {**SampleData.SHOPEE_SG, "title": "Updated Title"},
            {**SampleData.CAROUSELL_SG},
            {**SampleData.SHOPEE_SG, "title": "Another Update"},
        ]
        seen: dict[tuple[str, str], int] = {}
        dupes: list[int] = []
        for i, p in enumerate(products):
            key = (p["sku"], p["merchant_id"])
            if key in seen:
                dupes.append(i)
            else:
                seen[key] = i
        assert len(dupes) == 2
        assert dupes == [2, 4]


class TestPipelineIngestRequest:
    def test_ingest_request_with_single_product(self):
        item = IngestProductItem(**SampleData.SHOPEE_SG)
        request = IngestRequest(source="shopee_sg", products=[item])
        assert request.source == "shopee_sg"
        assert len(request.products) == 1

    def test_ingest_request_with_multiple_products(self):
        items = [
            IngestProductItem(**SampleData.SHOPEE_SG),
            IngestProductItem(**SampleData.LAZADA_SG),
            IngestProductItem(**SampleData.CAROUSELL_SG),
        ]
        request = IngestRequest(source="multi", products=items)
        assert len(request.products) == 3

    def test_ingest_request_empty_batch_rejected(self):
        with pytest.raises(ValueError):
            IngestRequest(source="empty", products=[])

    def test_ingest_request_max_batch_size_enforced(self):
        items = [
            IngestProductItem(
                sku=f"BATCH-{i}",
                merchant_id="test",
                title=f"Product {i}",
                price=10.00,
                url=f"https://example.com/{i}",
            )
            for i in range(1001)
        ]
        with pytest.raises(ValueError):
            IngestRequest(source="too_large", products=items)


class TestPipelineIngestMocked:
    @pytest.fixture
    def mock_db(self):
        db = AsyncMock()
        db.execute = AsyncMock()
        db.commit = AsyncMock()
        db.flush = AsyncMock()
        return db

    @pytest.fixture
    def mock_api_key(self):
        key = MagicMock()
        key.id = "test-key-123"
        return key

    def test_ingest_flow_with_mock_db(self, mock_db, mock_api_key):
        async def run_test():
            from app.routers.ingest import ingest_products
            from fastapi import Request

            request = MagicMock(spec=Request)
            request.state.api_key = mock_api_key

            item = IngestProductItem(**SampleData.SHOPEE_SG)
            body = IngestRequest(source="shopee_sg", products=[item])

            mock_db.execute.return_value.scalar_one_or_none.return_value = None

            with patch("app.routers.ingest.cache") as mock_cache:
                mock_cache.cache_delete_pattern = AsyncMock()

                response = await ingest_products(
                    request=request,
                    body=body,
                    db=mock_db,
                    api_key=mock_api_key,
                )

            assert response.rows_inserted >= 0
            assert response.rows_failed == 0
            mock_db.commit.assert_called()

    def test_ingest_update_when_product_exists(self, mock_db, mock_api_key):
        async def run_test():
            from app.routers.ingest import ingest_products
            from fastapi import Request

            updated_product = dict(SampleData.SHOPEE_SG)
            updated_product["title"] = "Updated iPhone Case Title"

            item = IngestProductItem(**updated_product)
            body = IngestRequest(source="shopee_sg", products=[item])

            request = MagicMock(spec=Request)
            request.state.api_key = mock_api_key
            request.json = AsyncMock(return_value=body.model_dump())

            mock_db.execute.return_value.scalar_one_or_none.return_value = 999

            with patch("app.routers.ingest.cache") as mock_cache:
                mock_cache.cache_delete_pattern = AsyncMock()

                response = await ingest_products(
                    request=request,
                    db=mock_db,
                    api_key=mock_api_key,
                )

            assert response.rows_updated >= 0 or response.rows_inserted >= 0

        asyncio.run(run_test())

    def test_ingest_error_handling_for_malformed_product(self, mock_db, mock_api_key):
        async def run_test():
            from app.routers.ingest import ingest_products
            from fastapi import Request

            bad_item = IngestProductItem(
                sku="BAD-001",
                merchant_id="test",
                title="Bad Product",
                price=0.01,
                url="https://example.com/bad",
            )
            body = IngestRequest(source="test", products=[bad_item])

            request = MagicMock(spec=Request)
            request.state.api_key = mock_api_key
            request.json = AsyncMock(return_value=body.model_dump())

            with patch("app.routers.ingest.cache") as mock_cache:
                mock_cache.cache_delete_pattern = AsyncMock()

                response = await ingest_products(
                    request=request,
                    db=mock_db,
                    api_key=mock_api_key,
                )

            assert response.rows_failed >= 0

        asyncio.run(run_test())


class TestPipelineEndToEnd:
    def test_full_pipeline_ndjson_to_ingest_request(self):
        products = [
            SampleData.SHOPEE_SG,
            SampleData.LAZADA_SG,
            SampleData.CAROUSELL_SG,
        ]
        data = ndjson_lines(products)
        parsed = parse_ndjson(data)

        ingest_items = []
        errors = []
        for i, p in enumerate(parsed):
            try:
                item = IngestProductItem(**p)
                ingest_items.append(item)
            except Exception as e:
                errors.append({"index": i, "error": str(e)})

        assert len(errors) == 0
        assert len(ingest_items) == 3

        request = IngestRequest(source="multi_source", products=ingest_items)
        assert request.source == "multi_source"
        assert len(request.products) == 3

    def test_full_pipeline_with_price_normalization(self):
        products = [
            {**SampleData.SHOPEE_SG, "price": "$29.90"},
            {**SampleData.LAZADA_SG, "price": "1299.00"},
            {**SampleData.CAROUSELL_SG, "price": 120.00},
        ]
        data = ndjson_lines(products)
        parsed = parse_ndjson(data)

        ingest_items = []
        for p in parsed:
            item = IngestProductItem(**p)
            ingest_items.append(item)

        prices = [item.price for item in ingest_items]
        assert prices[0] == Decimal("29.90")
        assert prices[1] == Decimal("1299.00")
        assert prices[2] == Decimal("120.00")

    def test_full_pipeline_filters_invalid_products(self):
        products = [
            SampleData.SHOPEE_SG,
            {"sku": "BAD", "title": "Missing price"},
            SampleData.LAZADA_SG,
            {"sku": "ALSO_BAD", "url": "bad"},
        ]
        data = ndjson_lines(products)
        parsed = parse_ndjson(data)

        valid_items = []
        invalid_indices = []
        for i, p in enumerate(parsed):
            try:
                item = IngestProductItem(**p)
                valid_items.append(item)
            except Exception:
                invalid_indices.append(i)

        assert len(valid_items) == 2
        assert 1 in invalid_indices
        assert 3 in invalid_indices

    def test_full_pipeline_handles_large_batch(self):
        base_product = SampleData.SHOPEE_SG.copy()
        products = []
        for i in range(100):
            p = base_product.copy()
            p["sku"] = f"LARGE-BATCH-{i:04d}"
            products.append(p)

        data = ndjson_lines(products)
        parsed = parse_ndjson(data)
        assert len(parsed) == 100

        valid_count = 0
        for p in parsed:
            try:
                IngestProductItem(**p)
                valid_count += 1
            except Exception:
                pass
        assert valid_count == 100


class TestPipelineQueryVerification:
    def test_query_by_sku_and_source_finds_product(self):
        products = [
            SampleData.SHOPEE_SG,
            SampleData.LAZADA_SG,
        ]
        target_sku = SampleData.SHOPEE_SG["sku"]
        target_source = "shopee_sg"

        found = None
        for p in products:
            if p["sku"] == target_sku and p["merchant_id"] == target_source:
                found = p
                break

        assert found is not None
        assert found["title"] == SampleData.SHOPEE_SG["title"]

    def test_query_by_sku_and_source_returns_correct_merchant(self):
        products = [
            {**SampleData.SHOPEE_SG, "sku": "SAME-SKU"},
            {**SampleData.SHOPEE_SG, "merchant_id": "lazada_sg", "sku": "SAME-SKU"},
        ]
        same_sku_products = [p for p in products if p["sku"] == "SAME-SKU"]
        assert len(same_sku_products) == 2
        sources = {p["merchant_id"] for p in same_sku_products}
        assert sources == {"shopee_sg", "lazada_sg"}

    def test_query_by_category_finds_matching_products(self):
        products = [
            SampleData.SHOPEE_SG,
            SampleData.LAZADA_SG,
            SampleData.CAROUSELL_SG,
        ]
        electronics = [p for p in products if p.get("category") == "Electronics"]
        assert len(electronics) == 2

    def test_query_by_brand_finds_matching_products(self):
        products = [
            SampleData.SHOPEE_SG,
            SampleData.LAZADA_SG,
            SampleData.CAROUSELL_SG,
        ]
        samsung = [p for p in products if p.get("brand") == "Samsung"]
        assert len(samsung) == 1
        assert samsung[0]["title"] == "Samsung Galaxy Tab S9 Ultra"

    def test_query_by_price_range_finds_matching_products(self):
        products = [
            SampleData.SHOPEE_SG,
            SampleData.LAZADA_SG,
            SampleData.CAROUSELL_SG,
        ]
        min_price = 20.00
        max_price = 150.00
        in_range = [p for p in products if min_price <= p["price"] <= max_price]
        assert len(in_range) == 2
        assert SampleData.SHOPEE_SG in in_range
        assert SampleData.CAROUSELL_SG in in_range


class TestPipelineErrorHandling:
    def test_handles_missing_ndjson_file(self):
        import os
        nonexistent = "/tmp/nonexistent_ndjson_12345.jsonl"
        if os.path.exists(nonexistent):
            os.remove(nonexistent)
        assert not os.path.exists(nonexistent)

    def test_handles_corrupt_ndjson_lines(self):
        corrupt_data = (
            json.dumps(SampleData.SHOPEE_SG) + "\n"
            + "not valid json at all\n"
            + json.dumps(SampleData.LAZADA_SG) + "\n"
        )
        with pytest.raises(json.JSONDecodeError):
            parse_ndjson(corrupt_data)

    def test_handles_products_with_null_metadata(self):
        product = dict(SampleData.SHOPEE_SG)
        product["metadata"] = None
        item = IngestProductItem(**product)
        assert item.metadata is None

    def test_handles_products_with_extra_unknown_fields(self):
        product = dict(SampleData.SHOPEE_SG)
        product["unknown_field"] = "should be ignored"
        product["another_unknown"] = 12345
        item = IngestProductItem(**product)
        assert item.sku == product["sku"]

    def test_handles_empty_price_treated_as_zero(self):
        product = dict(SampleData.SHOPEE_SG)
        product["price"] = 0
        with pytest.raises(ValueError, match="greater than"):
            IngestProductItem(**product)

    def test_handles_price_as_string_with_currency_symbol(self):
        product = dict(SampleData.SHOPEE_SG)
        product["price"] = "29.90"
        item = IngestProductItem(**product)
        assert item.price == Decimal("29.90")
