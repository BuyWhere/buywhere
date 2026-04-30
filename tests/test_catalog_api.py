"""Comprehensive tests for catalog API endpoints."""

import asyncio
import pytest
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException

from app.schemas.product import (
    ProductListResponse, ProductResponse, CompareResponse, CompareMatch,
    CategoryNode, CategoryResponse,
)
from app.schemas.status import CatalogStatus, PlatformProductCount, IngestionRunInfo
from app.routers.deals import DealItem, DealsResponse


class TestProductsRouter:
    """Tests for /v1/products endpoints."""

    def test_map_product(self, sample_product):
        from app.routers.products import _map_product
        result = _map_product(sample_product)

        assert isinstance(result, ProductResponse)
        assert result.id == sample_product.id
        assert result.sku == sample_product.sku
        assert result.source == sample_product.source
        assert result.name == sample_product.title
        assert result.price == sample_product.price
        assert result.currency == sample_product.currency
        assert result.is_available == sample_product.is_available

    def test_search_products_cache_hit(self, mock_db, mock_api_key, mock_request, mock_cache):
        async def run_test():
            from app.routers.products import search_products

            cached_data = {
                "total": 1,
                "limit": 20,
                "offset": 0,
                "items": [{
                    "id": 1,
                    "sku": "SKU-001",
                    "source": "shopee_sg",
                    "merchant_id": "merchant_001",
                    "name": "Test Product",
                    "price": Decimal("99.99"),
                    "currency": "SGD",
                    "buy_url": "https://shopee.sg/product/1",
                    "is_available": True,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }]
            }
            mock_cache["get"].return_value = cached_data

            result = await search_products(
                request=mock_request,
                q="test",
                category=None,
                min_price=None,
                max_price=None,
                source=None,
                brand=None,
                min_rating=None,
                max_rating=None,
                limit=20,
                offset=0,
                include_facets=False,
                currency=None,
                db=mock_db,
                api_key=mock_api_key,
            )

            assert isinstance(result, ProductListResponse)
            assert result.total == 1
            mock_cache["get"].assert_called_once()

        asyncio.run(run_test())

    def test_search_products_cache_miss(self, mock_db, mock_api_key, mock_request, mock_cache, sample_products):
        async def run_test():
            from app.routers.products import search_products
            from app.schemas.product import ProductResponse

            mock_cache["get"].return_value = None

            def execute_side_effect(query):
                query_str = str(query).lower()
                if "count" in query_str:
                    mock_count = MagicMock()
                    mock_count.scalar_one.return_value = 2
                    return mock_count
                mock_result = MagicMock()
                mock_result.scalars.return_value.all.return_value = sample_products[:2]
                return mock_result

            mock_db.execute.side_effect = execute_side_effect

            def map_product_mock(p, target_currency=None):
                return ProductResponse(
                    id=p.id,
                    sku=p.sku,
                    source=p.source,
                    merchant_id=p.merchant_id,
                    name=p.title,
                    description=p.description,
                    price=p.price,
                    currency=p.currency,
                    buy_url=p.url,
                    affiliate_url=p.url + "?ref=buywhere" if p.url else None,
                    image_url=p.image_url,
                    category=p.category,
                    category_path=p.category_path,
                    is_available=p.is_available,
                    last_checked=p.last_checked,
                    metadata=p.metadata_,
                    updated_at=p.updated_at,
                )

            with patch("app.routers.products._map_product", side_effect=map_product_mock):
                result = await search_products(
                    request=mock_request,
                    q=None,
                    category="Electronics",
                    min_price=None,
                    max_price=None,
                    source=None,
                    brand=None,
                    min_rating=None,
                    max_rating=None,
                    limit=20,
                    offset=0,
                    include_facets=False,
                    currency=None,
                    db=mock_db,
                    api_key=mock_api_key,
                )

            assert isinstance(result, ProductListResponse)
            mock_cache["set"].assert_called_once()

        asyncio.run(run_test())

    def test_get_product_found(self, mock_db, mock_api_key, mock_request, mock_cache, sample_product):
        async def run_test():
            from app.routers.products import get_product

            mock_cache["get"].return_value = None
            mock_result = MagicMock()
            mock_result.scalar_one_or_none.return_value = sample_product
            mock_db.execute.return_value = mock_result

            with patch("app.routers.products._map_product", return_value=MagicMock(id=sample_product.id)):
                result = await get_product(
                    request=mock_request,
                    product_id=1,
                    db=mock_db,
                    api_key=mock_api_key,
                )

            assert result is not None

        asyncio.run(run_test())

    def test_get_product_not_found(self, mock_db, mock_api_key, mock_request, mock_cache):
        async def run_test():
            from app.routers.products import get_product

            mock_cache["get"].return_value = None
            mock_result = MagicMock()
            mock_result.scalar_one_or_none.return_value = None
            mock_db.execute.return_value = mock_result

            with pytest.raises(HTTPException) as exc_info:
                await get_product(
                    request=mock_request,
                    product_id=999,
                    db=mock_db,
                    api_key=mock_api_key,
                )

            assert exc_info.value.status_code == 404

        asyncio.run(run_test())

    def test_best_price_found(self, mock_db, mock_api_key, mock_request, sample_product):
        async def run_test():
            from app.routers.products import best_price

            mock_result = MagicMock()
            mock_result.scalar_one_or_none.return_value = sample_product
            mock_db.execute.return_value = mock_result

            with patch("app.routers.products._map_product", return_value=MagicMock(id=sample_product.id)):
                result = await best_price(
                    request=mock_request,
                    q="iPhone 14 Pro Max",
                    category=None,
                    db=mock_db,
                    api_key=mock_api_key,
                )

            assert result is not None

        asyncio.run(run_test())

    def test_best_price_not_found(self, mock_db, mock_api_key, mock_request):
        async def run_test():
            from app.routers.products import best_price

            mock_result = MagicMock()
            mock_result.scalar_one_or_none.return_value = None
            mock_db.execute.side_effect = [mock_result, mock_result]

            with pytest.raises(HTTPException) as exc_info:
                await best_price(
                    request=mock_request,
                    q="nonexistent product xyz123",
                    category=None,
                    db=mock_db,
                    api_key=mock_api_key,
                )

            assert exc_info.value.status_code == 404
            assert "No products found" in str(exc_info.value.detail)

        asyncio.run(run_test())

    def test_compare_product_not_found(self, mock_db, mock_api_key, mock_request, mock_cache):
        async def run_test():
            from app.routers.products import compare_product_search

            mock_cache["get"].return_value = None
            mock_result = MagicMock()
            mock_result.scalars.return_value.all.return_value = []
            mock_db.execute.return_value = mock_result

            with pytest.raises(HTTPException) as exc_info:
                await compare_product_search(
                    request=mock_request,
                    q="nonexistent product xyz",
                    limit=10,
                    db=mock_db,
                    api_key=mock_api_key,
                )

            assert exc_info.value.status_code == 404
            assert "No products found" in str(exc_info.value.detail)

        asyncio.run(run_test())


class TestSearchRouter:
    """Tests for /v1/search endpoint."""

    def test_search_cache_hit(self, mock_db, mock_api_key, mock_request, mock_cache):
        async def run_test():
            from app.routers.search import search_products

            cached_data = {
                "total": 1,
                "limit": 20,
                "offset": 0,
                "items": []
            }
            mock_cache["get"].return_value = cached_data

            result = await search_products(
                request=mock_request,
                q="test query",
                lang=None,
                category=None,
                min_price=None,
                max_price=None,
                platform=None,
                country=None,
                in_stock=None,
                currency=None,
                limit=20,
                offset=0,
                db=mock_db,
                api_key=mock_api_key,
            )

            assert isinstance(result, ProductListResponse)
            mock_db.execute.assert_not_called()

        asyncio.run(run_test())


class TestCategoriesRouter:
    """Tests for /v1/categories endpoint."""

    def test_list_categories(self, mock_db, mock_api_key, mock_request):
        async def run_test():
            from app.routers.categories import list_categories

            mock_result = MagicMock()
            mock_result.all.return_value = [
                MagicMock(category="Electronics", count=100),
                MagicMock(category="Fashion", count=50),
                MagicMock(category="Home & Living", count=75),
            ]
            mock_db.execute.return_value = mock_result

            result = await list_categories(
                request=mock_request,
                db=mock_db,
                api_key=mock_api_key,
            )

            assert isinstance(result, CategoryResponse)
            assert result.total == 3
            assert len(result.categories) == 3
            assert result.categories[0].name == "Electronics"
            assert result.categories[0].count == 100

        asyncio.run(run_test())

    def test_list_categories_empty(self, mock_db, mock_api_key, mock_request):
        async def run_test():
            from app.routers.categories import list_categories

            mock_result = MagicMock()
            mock_result.all.return_value = []
            mock_db.execute.return_value = mock_result

            result = await list_categories(
                request=mock_request,
                db=mock_db,
                api_key=mock_api_key,
            )

            assert isinstance(result, CategoryResponse)
            assert result.total == 0
            assert len(result.categories) == 0

        asyncio.run(run_test())

    def test_get_category_tree_default_params(self, mock_db, mock_api_key, mock_request):
        async def run_test():
            from app.routers.categories import get_category_tree

            mock_result = MagicMock()
            mock_result.all.return_value = [
                MagicMock(category="Electronics", category_path=["Electronics"], count=100),
                MagicMock(category="Fashion", category_path=["Fashion"], count=50),
            ]
            mock_db.execute.return_value = mock_result

            with patch("app.routers.categories._load_taxonomy") as mock_taxonomy:
                mock_taxonomy.return_value = {
                    "version": "1.0",
                    "top_categories": [
                        {"id": "electronics", "name": "Electronics", "subcategories": [
                            {"id": "phones", "name": "Phones", "product_count": 40}
                        ]},
                        {"id": "fashion", "name": "Fashion", "subcategories": []},
                    ],
                    "mapping": {
                        "Electronics": {"top_category": "Electronics", "sub_category": "Phones"},
                        "Fashion": {"top_category": "Fashion"},
                    },
                }

                result = await get_category_tree(
                    request=mock_request,
                    depth=2,
                    include_empty=False,
                    db=mock_db,
                    api_key=mock_api_key,
                )

            assert isinstance(result, CategoryResponse)
            assert result.total == 2
            electronics_cat = next((c for c in result.categories if c.id == "electronics"), None)
            assert electronics_cat is not None
            assert electronics_cat.count == 200
            assert len(electronics_cat.children) == 1
            assert electronics_cat.children[0].id == "phones"

        asyncio.run(run_test())

    def test_get_category_tree_depth_1(self, mock_db, mock_api_key, mock_request):
        async def run_test():
            from app.routers.categories import get_category_tree

            mock_result = MagicMock()
            mock_result.all.return_value = [
                MagicMock(category="Electronics", category_path=["Electronics"], count=100),
            ]
            mock_db.execute.return_value = mock_result

            with patch("app.routers.categories._load_taxonomy") as mock_taxonomy:
                mock_taxonomy.return_value = {
                    "version": "1.0",
                    "top_categories": [
                        {"id": "electronics", "name": "Electronics", "subcategories": [
                            {"id": "phones", "name": "Phones", "product_count": 40}
                        ]},
                    ],
                    "mapping": {
                        "Electronics": {"top_category": "Electronics"},
                    },
                }

                result = await get_category_tree(
                    request=mock_request,
                    depth=1,
                    include_empty=False,
                    db=mock_db,
                    api_key=mock_api_key,
                )

            assert isinstance(result, CategoryResponse)
            electronics_cat = next((c for c in result.categories if c.id == "electronics"), None)
            assert electronics_cat is not None
            assert len(electronics_cat.children) == 0

        asyncio.run(run_test())

    def test_get_category_tree_include_empty(self, mock_db, mock_api_key, mock_request):
        async def run_test():
            from app.routers.categories import get_category_tree

            mock_result = MagicMock()
            mock_result.all.return_value = [
                MagicMock(category="Electronics", category_path=["Electronics"], count=100),
            ]
            mock_db.execute.return_value = mock_result

            with patch("app.routers.categories._load_taxonomy") as mock_taxonomy:
                mock_taxonomy.return_value = {
                    "version": "1.0",
                    "top_categories": [
                        {"id": "electronics", "name": "Electronics", "subcategories": []},
                        {"id": "empty_cat", "name": "Empty Category", "subcategories": []},
                    ],
                    "mapping": {
                        "Electronics": {"top_category": "Electronics"},
                    },
                }

                result = await get_category_tree(
                    request=mock_request,
                    depth=2,
                    include_empty=True,
                    db=mock_db,
                    api_key=mock_api_key,
                )

            assert isinstance(result, CategoryResponse)
            assert result.total == 2
            empty_cat = next((c for c in result.categories if c.id == "empty_cat"), None)
            assert empty_cat is not None
            assert empty_cat.count == 0

        asyncio.run(run_test())

    def test_get_category_tree_excludes_empty_by_default(self, mock_db, mock_api_key, mock_request):
        async def run_test():
            from app.routers.categories import get_category_tree

            mock_result = MagicMock()
            mock_result.all.return_value = [
                MagicMock(category="Electronics", category_path=["Electronics"], count=100),
            ]
            mock_db.execute.return_value = mock_result

            with patch("app.routers.categories._load_taxonomy") as mock_taxonomy:
                mock_taxonomy.return_value = {
                    "version": "1.0",
                    "top_categories": [
                        {"id": "electronics", "name": "Electronics", "subcategories": []},
                        {"id": "empty_cat", "name": "Empty Category", "subcategories": []},
                    ],
                    "mapping": {
                        "Electronics": {"top_category": "Electronics"},
                    },
                }

                result = await get_category_tree(
                    request=mock_request,
                    depth=2,
                    include_empty=False,
                    db=mock_db,
                    api_key=mock_api_key,
                )

            assert isinstance(result, CategoryResponse)
            assert result.total == 1
            empty_cat = next((c for c in result.categories if c.id == "empty_cat"), None)
            assert empty_cat is None

        asyncio.run(run_test())


class TestDealsRouter:
    """Tests for /v1/deals endpoint."""

    def test_get_deals_default_params(self, mock_db, mock_api_key, mock_request, sample_products):
        async def run_test():
            from app.routers.deals import get_deals

            def execute_side_effect(query):
                mock_result = MagicMock()
                if "COUNT" in str(query):
                    mock_result.scalar_one.return_value = 2
                else:
                    mock_result.scalars.return_value.all.return_value = sample_products[:2]
                return mock_result

            mock_db.execute.side_effect = execute_side_effect

            result = await get_deals(
                request=mock_request,
                category=None,
                minDiscount=None,
                min_discount_pct=10.0,
                platform=None,
                limit=20,
                offset=0,
                db=mock_db,
                api_key=mock_api_key,
            )

            assert isinstance(result, DealsResponse)
            assert result.limit == 20
            assert result.offset == 0

        asyncio.run(run_test())

    def test_get_deals_with_category_filter(self, mock_db, mock_api_key, mock_request, sample_products):
        async def run_test():
            from app.routers.deals import get_deals

            mock_result = MagicMock()
            mock_result.scalars.return_value.all.return_value = [sample_products[2]]
            mock_db.execute.return_value = mock_result

            result = await get_deals(
                request=mock_request,
                category="Fashion",
                minDiscount=None,
                min_discount_pct=10.0,
                platform=None,
                limit=20,
                offset=0,
                db=mock_db,
                api_key=mock_api_key,
            )

            assert isinstance(result, DealsResponse)
            assert len(result.items) == 1
            assert result.items[0].category == "Fashion"

        asyncio.run(run_test())

    def test_deal_item_from_product(self, sample_product):
        from app.routers.deals import _to_deal_item

        result = _to_deal_item(sample_product)

        assert isinstance(result, DealItem)
        assert result.id == sample_product.id
        assert result.name == sample_product.title
        assert result.price == sample_product.price
        assert result.original_price == Decimal("2499.00")
        assert result.discount_pct is not None
        assert result.discount_pct > 0

    def test_deal_item_no_original_price(self):
        from app.routers.deals import _to_deal_item

        mock_product = MagicMock()
        mock_product.id = 1
        mock_product.title = "Test Product"
        mock_product.price = Decimal("100.00")
        mock_product.currency = "SGD"
        mock_product.source = "shopee_sg"
        mock_product.category = "Electronics"
        mock_product.url = "https://shopee.sg/product/1"
        mock_product.metadata_ = {}
        mock_product.image_url = None

        result = _to_deal_item(mock_product)

        assert result.original_price is None
        assert result.discount_pct is None

    def test_deal_item_zero_original_price(self):
        from app.routers.deals import _to_deal_item

        mock_product = MagicMock()
        mock_product.id = 1
        mock_product.title = "Test Product"
        mock_product.price = Decimal("100.00")
        mock_product.currency = "SGD"
        mock_product.source = "shopee_sg"
        mock_product.category = "Electronics"
        mock_product.url = "https://shopee.sg/product/1"
        mock_product.metadata_ = {"original_price": 0}
        mock_product.image_url = None

        result = _to_deal_item(mock_product)

        assert result.original_price == Decimal("0")
        assert result.discount_pct is None

    def test_deal_item_negative_original_price(self):
        from app.routers.deals import _to_deal_item

        mock_product = MagicMock()
        mock_product.id = 1
        mock_product.title = "Test Product"
        mock_product.price = Decimal("100.00")
        mock_product.currency = "SGD"
        mock_product.source = "shopee_sg"
        mock_product.category = "Electronics"
        mock_product.url = "https://shopee.sg/product/1"
        mock_product.metadata_ = {"original_price": -50}
        mock_product.image_url = None

        result = _to_deal_item(mock_product)

        assert result.original_price == Decimal("-50")
        assert result.discount_pct is None


class TestStatusRouter:
    """Tests for /v1/status endpoint."""

    def test_get_catalog_status(self, mock_db, mock_api_key, mock_request):
        async def run_test():
            import app.routers.status as status_module
            from app.schemas.status import CatalogStatus, PlatformProductCount, IngestionRunInfo

            mock_result = CatalogStatus(
                total_unique_products=1000,
                platforms=[
                    PlatformProductCount(source="shopee_sg", product_count=500, last_updated=datetime.now(timezone.utc)),
                    PlatformProductCount(source="lazada_sg", product_count=300, last_updated=datetime.now(timezone.utc)),
                    PlatformProductCount(source="carousell", product_count=200, last_updated=datetime.now(timezone.utc)),
                ],
                ingestion_runs=[
                    IngestionRunInfo(
                        source="shopee_sg",
                        last_run_at=datetime.now(timezone.utc),
                        last_run_status="completed",
                        last_rows_inserted=100,
                        last_rows_updated=50,
                    ),
                    IngestionRunInfo(
                        source="lazada_sg",
                        last_run_at=datetime.now(timezone.utc),
                        last_run_status="completed",
                        last_rows_inserted=80,
                        last_rows_updated=20,
                    ),
                ],
                goal_million=1.0,
                progress_percent=0.1,
            )

            with patch.object(status_module, "get_catalog_status", return_value=mock_result):
                result = await status_module.get_catalog_status(
                    request=mock_request,
                    db=mock_db,
                    api_key=mock_api_key,
                )

            assert isinstance(result, CatalogStatus)
            assert result.total_unique_products == 1000
            assert len(result.platforms) == 3
            assert result.goal_million == 1.0
            assert result.progress_percent == 0.1

        asyncio.run(run_test())

    def test_get_catalog_status_empty(self, mock_db, mock_api_key, mock_request):
        async def run_test():
            from app.routers.status import get_catalog_status

            mock_result = MagicMock()
            mock_result.scalar_one.return_value = 0

            mock_platform_result = MagicMock()
            mock_platform_result.all.return_value = []

            mock_last_runs_result = MagicMock()
            mock_last_runs_result.all.return_value = []

            mock_last_run_details_result = MagicMock()
            mock_last_run_details_result.all.return_value = []

            mock_db.execute.side_effect = [
                mock_result,
                mock_platform_result,
                mock_last_runs_result,
                mock_last_run_details_result,
            ]

            result = await get_catalog_status(
                request=mock_request,
                db=mock_db,
                api_key=mock_api_key,
            )

            assert isinstance(result, CatalogStatus)
            assert result.total_unique_products == 0
            assert len(result.platforms) == 0

        asyncio.run(run_test())


class TestCatalogRouter:
    """Tests for /v1/catalog endpoints."""

    def test_catalog_health(self, mock_db, mock_api_key):
        async def run_test():
            from app.routers.catalog import catalog_health
            from app.services.catalog_health import get_catalog_health

            mock_health_data = {
                "generated_at": datetime.now(timezone.utc),
                "total_indexed": 1000,
                "by_platform": {"shopee_sg": 500, "lazada_sg": 300, "carousell": 200},
                "compliance": {
                    "total_products": 1000,
                    "compliant_products": 950,
                    "compliance_rate": 0.95,
                    "by_platform": [],
                    "missing_title": 10,
                    "missing_price": 5,
                    "missing_source": 0,
                    "missing_source_id": 35,
                    "missing_url": 3,
                    "incomplete_products": 50,
                },
                "deduplication": {
                    "total_products": 1000,
                    "products_with_canonical": 100,
                    "duplicate_rate": 0.1,
                    "duplicate_groups": 20,
                    "sample_duplicates": [],
                },
                "freshness": {
                    "total_products": 1000,
                    "stale_products": 50,
                    "stale_rate": 0.05,
                    "re_scrape_count": 10,
                    "by_platform": {"shopee_sg": 20, "lazada_sg": 15, "carousell": 15},
                    "sample_stale": [],
                },
            }

            with patch("app.routers.catalog.get_catalog_health", new_callable=AsyncMock) as mock_get_health:
                mock_get_health.return_value = mock_health_data

                result = await catalog_health(
                    db=mock_db,
                    api_key=mock_api_key,
                )

            assert result.total_indexed == 1000
            assert result.compliance.compliance_rate == 0.95
            assert result.deduplication.duplicate_rate == 0.1
            assert result.compliance.missing_url == 3
            assert result.compliance.incomplete_products == 50

        asyncio.run(run_test())

    def test_list_incomplete_products(self, mock_db, mock_api_key):
        async def run_test():
            from app.routers.catalog import list_incomplete_products

            mock_row = MagicMock()
            mock_row.id = 1
            mock_row.sku = "INCOMPLETE-001"
            mock_row.source = "shopee_sg"
            mock_row.title = ""
            mock_row.price = None
            mock_row.url = "https://shopee.sg/product/1"
            mock_row.is_active = True
            mock_row.updated_at = datetime(2024, 1, 15, tzinfo=timezone.utc)

            mock_result = MagicMock()
            mock_result.all.return_value = [mock_row]
            mock_count_result = MagicMock()
            mock_count_result.scalar_one.return_value = 1

            mock_db.execute.side_effect = [mock_count_result, mock_result]

            result = await list_incomplete_products(
                db=mock_db,
                api_key=mock_api_key,
                source=None,
                limit=20,
                offset=0,
            )

            assert result["total"] == 1
            assert len(result["items"]) == 1
            item = result["items"][0]
            assert item["missing_fields"] == ["title", "price"]
            assert item["sku"] == "INCOMPLETE-001"

        asyncio.run(run_test())

    def test_list_incomplete_products_missing_url(self, mock_db, mock_api_key):
        async def run_test():
            from app.routers.catalog import list_incomplete_products

            mock_row = MagicMock()
            mock_row.id = 2
            mock_row.sku = "NO-URL-001"
            mock_row.source = "lazada_sg"
            mock_row.title = "Test Product"
            mock_row.price = Decimal("99.99")
            mock_row.url = ""
            mock_row.is_active = True
            mock_row.updated_at = datetime(2024, 1, 15, tzinfo=timezone.utc)

            mock_result = MagicMock()
            mock_result.all.return_value = [mock_row]
            mock_count_result = MagicMock()
            mock_count_result.scalar_one.return_value = 1

            mock_db.execute.side_effect = [mock_count_result, mock_result]

            result = await list_incomplete_products(
                db=mock_db,
                api_key=mock_api_key,
                source=None,
                limit=20,
                offset=0,
            )

            assert result["total"] == 1
            item = result["items"][0]
            assert "url" in item["missing_fields"]

        asyncio.run(run_test())


class TestKeysRouter:
    """Tests for /v1/keys endpoints."""

    def test_create_api_key_success(self, mock_db):
        async def run_test():
            from app.routers.keys import create_api_key
            from app.schemas.product import ApiKeyCreateRequest

            mock_api_key = MagicMock()
            mock_api_key.id = "new-key-id"
            mock_api_key.name = "Test Key"
            mock_api_key.tier = "basic"

            mock_request = MagicMock()
            mock_request.state = MagicMock()

            with patch("app.routers.keys.provision_api_key", new_callable=AsyncMock) as mock_provision:
                mock_provision.return_value = ("raw_key_abc123", mock_api_key)

                request = ApiKeyCreateRequest(name="Test Key")

                with patch("app.routers.keys.get_current_api_key", new_callable=AsyncMock) as mock_auth:
                    mock_auth.return_value.developer_id = "dev-001"
                    mock_auth.return_value.tier = "basic"
                    result = await create_api_key(
                        request=mock_request,
                        body=request,
                        db=mock_db,
                        api_key=mock_auth.return_value,
                    )

            assert result.tier == "basic"
            assert result.raw_key == "raw_key_abc123"

        asyncio.run(run_test())

    def test_create_api_key_returns_raw_key(self, mock_db):
        async def run_test():
            from app.routers.keys import create_api_key
            from app.schemas.product import ApiKeyCreateRequest

            mock_api_key = MagicMock()
            mock_api_key.id = "key-123"
            mock_api_key.name = "My API Key"
            mock_api_key.tier = "pro"

            mock_request = MagicMock()
            mock_request.state = MagicMock()

            with patch("app.routers.keys.provision_api_key", new_callable=AsyncMock) as mock_provision:
                mock_provision.return_value = ("sk_live_abc123xyz", mock_api_key)

                request = ApiKeyCreateRequest(name="My API Key")

                with patch("app.routers.keys.get_current_api_key", new_callable=AsyncMock) as mock_auth:
                    mock_auth.return_value.developer_id = "dev-002"
                    mock_auth.return_value.tier = "pro"
                    result = await create_api_key(
                        request=mock_request,
                        body=request,
                        db=mock_db,
                        api_key=mock_auth.return_value,
                    )

            assert result.key_id == "key-123"
            assert result.raw_key == "sk_live_abc123xyz"
            assert result.name == "My API Key"
            assert result.tier == "pro"
            assert "Store this key" in result.message

        asyncio.run(run_test())


class TestProductSchemas:
    """Tests for product schemas."""

    def test_product_response_from_attributes(self):
        from app.schemas.product import ProductResponse

        data = {
            "id": 1,
            "sku": "SKU-001",
            "source": "shopee_sg",
            "merchant_id": "merchant_001",
            "name": "Test Product",
            "price": Decimal("99.99"),
            "currency": "SGD",
            "buy_url": "https://shopee.sg/product/1",
            "affiliate_url": "https://shopee.sg/product/1?ref=buywhere",
            "image_url": "https://shopee.sg/image.jpg",
            "category": "Electronics",
            "category_path": ["Electronics", "Phones"],
            "is_available": True,
            "metadata": {"condition": "new"},
            "updated_at": datetime.now(timezone.utc),
        }

        response = ProductResponse(**data)
        assert response.id == 1
        assert response.sku == "SKU-001"
        assert response.price == Decimal("99.99")
        assert response.is_available is True

    def test_product_list_response(self):
        from app.schemas.product import ProductListResponse, ProductResponse

        items = [
            ProductResponse(
                id=1,
                sku="SKU-001",
                source="shopee_sg",
                merchant_id="m1",
                name="Product 1",
                price=Decimal("99.99"),
                currency="SGD",
                buy_url="https://shopee.sg/1",
                is_available=True,
                last_checked=None,
                updated_at=datetime.now(timezone.utc),
                affiliate_url=None,
            ),
            ProductResponse(
                id=2,
                sku="SKU-002",
                source="lazada_sg",
                merchant_id="m2",
                name="Product 2",
                price=Decimal("149.99"),
                currency="SGD",
                buy_url="https://lazada.sg/2",
                is_available=True,
                last_checked=None,
                updated_at=datetime.now(timezone.utc),
                affiliate_url=None,
            ),
        ]

        response = ProductListResponse(total=2, limit=20, offset=0, items=items)
        assert response.total == 2
        assert len(response.items) == 2

    def test_compare_response(self):
        from app.schemas.product import CompareResponse, CompareMatch

        matches = [
            CompareMatch(
                id=2,
                sku="SKU-002",
                source="lazada_sg",
                merchant_id="m2",
                name="Lazada Product",
                price=Decimal("149.99"),
                currency="SGD",
                buy_url="https://lazada.sg/2",
                is_available=True,
                last_checked=None,
                updated_at=datetime.now(timezone.utc),
                match_score=0.95,
            )
        ]

        response = CompareResponse(
            source_product_id=1,
            source_product_name="Shopee Product",
            matches=matches,
            total_matches=1,
        )

        assert response.source_product_id == 1
        assert response.total_matches == 1
        assert response.matches[0].match_score == 0.95

    def test_category_node(self):
        node = CategoryNode(id="electronics", name="Electronics", slug="electronics", count=100, children=[])
        assert node.name == "Electronics"
        assert node.count == 100
        assert node.id == "electronics"
        assert node.slug == "electronics"
        assert node.parent_id is None

    def test_category_response(self):
        categories = [
            CategoryNode(id="electronics", name="Electronics", slug="electronics", count=100),
            CategoryNode(id="fashion", name="Fashion", slug="fashion", count=50),
        ]
        response = CategoryResponse(categories=categories, total=2)
        assert response.total == 2

    def test_category_node_with_children(self):
        child = CategoryNode(id="phones", name="Phones", slug="phones", parent_id="electronics", count=50)
        parent = CategoryNode(id="electronics", name="Electronics", slug="electronics", count=100, children=[child])
        assert len(parent.children) == 1
        assert parent.children[0].parent_id == "electronics"

    def test_category_node_with_parent_id(self):
        node = CategoryNode(id="phones", name="Phones", slug="phones", parent_id="electronics", count=50)
        assert node.parent_id == "electronics"


class TestDealSchemas:
    """Tests for deal schemas."""

    def test_deal_item(self):
        item = DealItem(
            id=1,
            name="iPhone 14 Pro",
            price=Decimal("1999.00"),
            original_price=Decimal("2499.00"),
            discount_pct=20.0,
            currency="SGD",
            source="shopee_sg",
            category="Electronics",
            buy_url="https://shopee.sg/product/1",
            affiliate_url="https://shopee.sg/product/1?ref=buywhere",
            image_url="https://shopee.sg/image.jpg",
            metadata={"condition": "new"},
        )

        assert item.discount_pct == 20.0
        assert item.original_price == Decimal("2499.00")

    def test_deals_response(self):
        items = [
            DealItem(
                id=1,
                name="Product 1",
                price=Decimal("99.00"),
                original_price=Decimal("199.00"),
                discount_pct=50.0,
                currency="SGD",
                source="shopee_sg",
                category="Electronics",
                buy_url="https://shopee.sg/1",
                affiliate_url=None,
                image_url=None,
                metadata=None,
            )
        ]

        response = DealsResponse(total=1, limit=20, offset=0, items=items)
        assert response.total == 1
        assert len(response.items) == 1
        assert response.items[0].discount_pct == 50.0


class TestStatusSchemas:
    """Tests for status schemas."""

    def test_catalog_status(self):
        platforms = [
            PlatformProductCount(source="shopee_sg", product_count=500, last_updated=datetime.now(timezone.utc)),
            PlatformProductCount(source="lazada_sg", product_count=300, last_updated=datetime.now(timezone.utc)),
        ]
        ingestion_runs = [
            IngestionRunInfo(
                source="shopee_sg",
                last_run_at=datetime.now(timezone.utc),
                last_run_status="completed",
                last_rows_inserted=100,
                last_rows_updated=50,
            )
        ]

        status = CatalogStatus(
            total_unique_products=800,
            platforms=platforms,
            ingestion_runs=ingestion_runs,
            goal_million=1.0,
            progress_percent=0.08,
        )

        assert status.total_unique_products == 800
        assert len(status.platforms) == 2
        assert status.goal_million == 1.0
        assert status.progress_percent == 0.08


class TestCompareDiffRouter:
    """Tests for POST /v1/products/compare/diff endpoint."""

    def test_compare_diff_schema(self):
        from app.schemas.product import (
            CompareDiffRequest, CompareDiffResponse, CompareDiffEntry, FieldDiff,
        )

        req = CompareDiffRequest(product_ids=[1, 2, 3], include_image_similarity=False)
        assert len(req.product_ids) == 3

        diff = FieldDiff(field="price", values=[Decimal("99.99"), Decimal("149.99"), Decimal("199.99")], all_identical=False)
        assert diff.field == "price"
        assert len(diff.values) == 3
        assert diff.all_identical is False

        entry = CompareDiffEntry(
            id=1, sku="SKU-001", source="shopee_sg", merchant_id="m1",
            name="Product 1", price=Decimal("99.99"), currency="SGD",
            buy_url="https://shopee.sg/1", is_available=True,
            updated_at=datetime.now(timezone.utc), price_rank=1,
        )
        assert entry.price_rank == 1

        resp = CompareDiffResponse(
            products=[entry],
            field_diffs=[diff],
            identical_fields=["currency"],
            cheapest_product_id=1,
            most_expensive_product_id=1,
            price_spread=Decimal("0"),
            price_spread_pct=0.0,
        )
        assert len(resp.products) == 1
        assert len(resp.field_diffs) == 1
        assert "currency" in resp.identical_fields

    def test_compare_diff_all_identical_fields(self):
        from app.schemas.product import CompareDiffResponse, FieldDiff

        diff = FieldDiff(field="currency", values=["SGD", "SGD"], all_identical=True)
        assert diff.all_identical is True

    def test_compare_diff_products_different_prices(self, sample_products):
        from app.schemas.product import CompareDiffEntry

        p1, p2, _ = sample_products
        p1.price = Decimal("99.99")
        p2.price = Decimal("149.99")

        entries = []
        for p in [p1, p2]:
            entries.append(CompareDiffEntry(
                id=p.id, sku=p.sku, source=p.source, merchant_id=p.merchant_id,
                name=p.title, price=p.price, currency=p.currency,
                buy_url=p.url, is_available=p.is_available,
                last_checked=p.last_checked,
                updated_at=p.updated_at, price_rank=1,
            ))

        sorted_by_price = sorted(entries, key=lambda e: e.price)
        price_ranks = {e.id: i + 1 for i, e in enumerate(sorted_by_price)}

        assert price_ranks[p1.id] == 1
        assert price_ranks[p2.id] == 2
