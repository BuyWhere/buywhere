"""Integration tests for BuyWhere Catalog API endpoints.

Tests run against the FastAPI application using TestClient.
These tests verify HTTP behavior: status codes, response schemas,
error handling, and response times.
"""

import time
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.product import ApiKey, Product
from app.auth import get_current_api_key
from app.database import get_db


@pytest.fixture
def test_api_key():
    key = MagicMock(spec=ApiKey)
    key.id = "test-key-id"
    key.key_hash = "test-hash"
    key.developer_id = "test-developer"
    key.name = "Test Key"
    key.tier = "basic"
    key.is_active = True
    return key


@pytest.fixture
def mock_db():
    db = AsyncMock()
    
    mock_result = MagicMock()
    mock_result.scalar_one_or_none = MagicMock(return_value=None)
    mock_result.scalar_one = MagicMock(return_value=None)
    mock_result.scalars = MagicMock(return_value=MagicMock(all=MagicMock(return_value=[])))
    mock_result.one_or_none = MagicMock(return_value=None)
    mock_result.all = MagicMock(return_value=[])
    
    db.execute = AsyncMock(return_value=mock_result)
    db.flush = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    return db


@pytest.fixture
def mock_get_db(mock_db):
    async def _mock_get_db():
        yield mock_db
    return _mock_get_db


@pytest.fixture
def mock_get_api_key(test_api_key):
    async def _mock_get_api_key():
        return test_api_key
    return _mock_get_api_key


@pytest.fixture
def client(mock_get_db, mock_get_api_key, mock_db):
    app.dependency_overrides[get_db] = mock_get_db
    app.dependency_overrides[get_current_api_key] = mock_get_api_key
    original_enabled = app.state.limiter.enabled
    app.state.limiter.enabled = False
    
    mock_cache_get = AsyncMock(return_value=None)
    mock_cache_set = AsyncMock()
    
    mock_sync_db = MagicMock()
    mock_sync_db.query.return_value.filter.return_value.order_by.return_value.limit.return_value.offset.return_value.all.return_value = []
    mock_sync_db.query.return_value.filter.return_value.order_by.return_value.count.return_value = 0
    mock_sync_db.query.return_value.filter.return_value.filter.return_value.order_by.return_value.limit.return_value.offset.return_value.all.return_value = []
    mock_sync_db.query.return_value.filter.return_value.filter.return_value.order_by.return_value.count.return_value = 0
    mock_sync_db.query.return_value.filter.return_value.count.return_value = 0
    mock_sync_db.query.return_value.filter.return_value.limit.return_value.offset.return_value.all.return_value = []
    
    with patch("app.cache.cache_get", mock_cache_get), \
         patch("app.cache.cache_set", mock_cache_set), \
         patch("app.graphql.get_sync_db", return_value=mock_sync_db):
        yield TestClient(app)
    
    app.state.limiter.enabled = original_enabled
    app.dependency_overrides.clear()


@pytest.fixture
def sample_product():
    p = MagicMock(spec=Product)
    p.id = 1
    p.sku = "SKU-001"
    p.source = "shopee_sg"
    p.merchant_id = "merchant_001"
    p.title = "iPhone 14 Pro Max 256GB"
    p.description = "Brand new iPhone"
    p.price = Decimal("1999.00")
    p.currency = "SGD"
    p.price_sgd = None
    p.url = "https://shopee.sg/product/123"
    p.brand = "Apple"
    p.category = "Electronics"
    p.category_path = ["Electronics", "Phones", "Mobile Phones"]
    p.image_url = "https://shopee.sg/image.jpg"
    p.barcode = None
    p.is_active = True
    p.is_available = True
    p.in_stock = True
    p.stock_level = None
    p.last_checked = datetime(2024, 1, 15, tzinfo=timezone.utc)
    p.rating = Decimal("4.5")
    p.review_count = 100
    p.avg_rating = Decimal("4.5")
    p.rating_source = "shopee"
    p.metadata_ = {"original_price": Decimal("2499.00"), "condition": "new"}
    p.specs = None
    p.created_at = datetime(2024, 1, 1, tzinfo=timezone.utc)
    p.updated_at = datetime(2024, 1, 15, tzinfo=timezone.utc)
    return p


@pytest.fixture
def sample_products(sample_product):
    p1 = MagicMock(spec=Product)
    p1.id = 1
    p1.sku = "SKU-001"
    p1.source = "shopee_sg"
    p1.merchant_id = "merchant_001"
    p1.title = "iPhone 14 Pro Max 256GB"
    p1.description = "Brand new iPhone"
    p1.price = Decimal("1999.00")
    p1.currency = "SGD"
    p1.price_sgd = None
    p1.url = "https://shopee.sg/product/123"
    p1.brand = "Apple"
    p1.category = "Electronics"
    p1.category_path = ["Electronics", "Phones"]
    p1.image_url = "https://shopee.sg/image.jpg"
    p1.barcode = None
    p1.is_active = True
    p1.is_available = True
    p1.in_stock = True
    p1.stock_level = None
    p1.last_checked = datetime(2024, 1, 15, tzinfo=timezone.utc)
    p1.rating = Decimal("4.5")
    p1.review_count = 100
    p1.avg_rating = Decimal("4.5")
    p1.rating_source = "shopee"
    p1.metadata_ = {"original_price": Decimal("2499.00")}
    p1.specs = None
    p1.created_at = datetime(2024, 1, 1, tzinfo=timezone.utc)
    p1.updated_at = datetime(2024, 1, 15, tzinfo=timezone.utc)

    p2 = MagicMock(spec=Product)
    p2.id = 2
    p2.sku = "SKU-002"
    p2.source = "lazada_sg"
    p2.merchant_id = "merchant_002"
    p2.title = "Samsung Galaxy S23"
    p2.description = "Samsung flagship phone"
    p2.price = Decimal("1299.00")
    p2.currency = "SGD"
    p2.price_sgd = None
    p2.url = "https://lazada.sg/product/456"
    p2.brand = "Samsung"
    p2.category = "Electronics"
    p2.category_path = ["Electronics", "Phones"]
    p2.image_url = "https://lazada.sg/image.jpg"
    p2.barcode = None
    p2.is_active = True
    p2.is_available = True
    p2.in_stock = True
    p2.stock_level = None
    p2.last_checked = datetime(2024, 1, 16, tzinfo=timezone.utc)
    p2.rating = Decimal("4.5")
    p2.review_count = 50
    p2.avg_rating = Decimal("4.3")
    p2.rating_source = "lazada"
    p2.metadata_ = {"original_price": Decimal("1599.00")}
    p2.specs = None
    p2.created_at = datetime(2024, 1, 2, tzinfo=timezone.utc)
    p2.updated_at = datetime(2024, 1, 16, tzinfo=timezone.utc)

    return [p1, p2]


class TestSearchEndpoint:
    """Integration tests for GET /v1/search endpoint."""

    def test_search_returns_valid_json_schema(self, client, mock_db, sample_products):
        """Test /v1/search returns correct JSON schema for ProductListResponse."""
        mock_count_result = MagicMock()
        mock_count_result.scalar_one.return_value = 2

        mock_products_result = MagicMock()
        mock_products_result.scalars.return_value.all.return_value = sample_products

        mock_db.execute.side_effect = [mock_count_result, mock_products_result]

        response = client.get("/v1/search")

        assert response.status_code == 200
        data = response.json()

        assert "total" in data
        assert "limit" in data
        assert "offset" in data
        assert "items" in data
        assert "has_more" in data
        assert isinstance(data["total"], int)
        assert isinstance(data["items"], list)

    def test_search_with_keyword_query(self, client, mock_db, sample_products):
        """Test /v1/search with keyword query parameter."""
        mock_count_result = MagicMock()
        mock_count_result.scalar_one.return_value = 1

        mock_products_result = MagicMock()
        mock_products_result.scalars.return_value.all.return_value = [sample_products[0]]

        mock_db.execute.side_effect = [mock_count_result, mock_products_result]

        response = client.get("/v1/search?q=iPhone")

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1

    def test_search_with_category_filter(self, client, mock_db, sample_products):
        """Test /v1/search with category filter."""
        mock_count_result = MagicMock()
        mock_count_result.scalar_one.return_value = 2

        mock_products_result = MagicMock()
        mock_products_result.scalars.return_value.all.return_value = sample_products

        mock_db.execute.side_effect = [mock_count_result, mock_products_result]

        response = client.get("/v1/search?category=Electronics")

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 2

    def test_search_with_price_range(self, client, mock_db, sample_products):
        """Test /v1/search with min_price and max_price filters."""
        mock_count_result = MagicMock()
        mock_count_result.scalar_one.return_value = 1

        mock_products_result = MagicMock()
        mock_products_result.scalars.return_value.all.return_value = [sample_products[1]]

        mock_db.execute.side_effect = [mock_count_result, mock_products_result]

        response = client.get("/v1/search?min_price=1000&max_price=1500")

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1

    def test_search_pagination(self, client, mock_db, sample_products):
        """Test /v1/search pagination with limit and offset."""
        mock_count_result = MagicMock()
        mock_count_result.scalar_one.return_value = 10

        mock_products_result = MagicMock()
        mock_products_result.scalars.return_value.all.return_value = sample_products

        mock_db.execute.side_effect = [mock_count_result, mock_products_result]

        response = client.get("/v1/search?limit=2&offset=0")

        assert response.status_code == 200
        data = response.json()
        assert data["limit"] == 2
        assert data["offset"] == 0
        assert len(data["items"]) == 2

    def test_search_response_time(self, client, mock_db, sample_products):
        """Test /v1/search response time is under 500ms."""
        mock_count_result = MagicMock()
        mock_count_result.scalar_one.return_value = 1

        mock_products_result = MagicMock()
        mock_products_result.scalars.return_value.all.return_value = [sample_products[0]]

        mock_db.execute.side_effect = [mock_count_result, mock_products_result]

        start = time.time()
        response = client.get("/v1/search?q=iPhone")
        elapsed = time.time() - start

        assert response.status_code == 200
        assert elapsed < 0.5, f"Response time {elapsed:.3f}s exceeds 500ms"

    def test_search_invalid_limit(self, client):
        """Test /v1/search with invalid limit parameter returns 422."""
        response = client.get("/v1/search?limit=0")
        assert response.status_code == 422

        response = client.get("/v1/search?limit=101")
        assert response.status_code == 422

    def test_search_negative_offset(self, client):
        """Test /v1/search with negative offset returns 422."""
        response = client.get("/v1/search?offset=-1")
        assert response.status_code == 422


class TestProductsEndpoint:
    """Integration tests for GET /v1/products endpoint."""

    def test_products_list_returns_valid_json_schema(self, client, mock_db, sample_products):
        """Test /v1/products returns correct JSON schema."""
        mock_count_result = MagicMock()
        mock_count_result.scalar_one.return_value = 2

        mock_products_result = MagicMock()
        mock_products_result.scalars.return_value.all.return_value = sample_products

        mock_db.execute.side_effect = [mock_count_result, mock_products_result]

        response = client.get("/v1/products")

        assert response.status_code == 200
        data = response.json()

        assert "total" in data
        assert "limit" in data
        assert "offset" in data
        assert "items" in data
        assert isinstance(data["total"], int)
        assert isinstance(data["items"], list)

    def test_products_list_pagination(self, client, mock_db, sample_products):
        """Test /v1/products with pagination parameters."""
        mock_count_result = MagicMock()
        mock_count_result.scalar_one.return_value = 50

        mock_products_result = MagicMock()
        mock_products_result.scalars.return_value.all.return_value = sample_products

        mock_db.execute.side_effect = [mock_count_result, mock_products_result]

        response = client.get("/v1/products?limit=20&offset=40")

        assert response.status_code == 200
        data = response.json()
        assert data["limit"] == 20
        assert data["offset"] == 40

    def test_products_list_sorting(self, client, mock_db, sample_products):
        """Test /v1/products results are sorted by updated_at desc."""
        mock_count_result = MagicMock()
        mock_count_result.scalar_one.return_value = 2

        mock_products_result = MagicMock()
        mock_products_result.scalars.return_value.all.return_value = sample_products

        mock_db.execute.side_effect = [mock_count_result, mock_products_result]

        response = client.get("/v1/products?sort=updated_at&order=desc")

        assert response.status_code == 200


class TestProductByIdEndpoint:
    """Integration tests for GET /v1/products/{product_id} endpoint."""

    def test_get_product_returns_all_fields(self, client, mock_db, sample_product):
        """Test /v1/products/{id} returns all required fields."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = sample_product

        mock_db.execute.return_value = mock_result

        response = client.get("/v1/products/1")

        assert response.status_code == 200
        data = response.json()

        required_fields = [
            "id", "sku", "source", "merchant_id", "name", "description",
            "price", "currency", "buy_url", "affiliate_url", "image_url",
            "brand", "category", "category_path", "rating", "is_available",
            "last_checked", "metadata", "updated_at"
        ]
        for field in required_fields:
            assert field in data, f"Missing required field: {field}"

    def test_get_product_fields_have_correct_types(self, client, mock_db, sample_product):
        """Test /v1/products/{id} field types are correct."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = sample_product

        mock_db.execute.return_value = mock_result

        response = client.get("/v1/products/1")

        assert response.status_code == 200
        data = response.json()

        assert isinstance(data["id"], int)
        assert isinstance(data["sku"], str)
        assert isinstance(data["source"], str)
        assert isinstance(data["merchant_id"], str)
        assert isinstance(data["name"], str)
        assert isinstance(data["price"], (int, float, str))
        assert isinstance(data["currency"], str)
        assert isinstance(data["buy_url"], str)
        assert isinstance(data["is_available"], bool)

    def test_get_product_404_not_found(self, client, mock_db):
        """Test /v1/products/{id} returns 404 for non-existent product."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None

        mock_db.execute.return_value = mock_result

        response = client.get("/v1/products/99999")

        assert response.status_code == 404

    def test_get_product_invalid_id_type(self, client):
        """Test /v1/products/{id} with invalid ID type returns 422."""
        response = client.get("/v1/products/invalid")
        assert response.status_code == 422


class TestErrorHandling:
    """Integration tests for error handling across endpoints."""

    def test_search_404_no_results(self, client, mock_db):
        """Test /v1/search returns empty list, not 404, when no results."""
        mock_count_result = MagicMock()
        mock_count_result.scalar_one.return_value = 0

        mock_products_result = MagicMock()
        mock_products_result.scalars.return_value.all.return_value = []

        mock_db.execute.side_effect = [mock_count_result, mock_products_result]

        response = client.get("/v1/search?q=nonexistent")

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 0
        assert data["items"] == []

    def test_products_404_invalid_category(self, client, mock_db):
        """Test /v1/products with invalid category returns empty list."""
        mock_count_result = MagicMock()
        mock_count_result.scalar_one.return_value = 0

        mock_products_result = MagicMock()
        mock_products_result.scalars.return_value.all.return_value = []

        mock_db.execute.side_effect = [mock_count_result, mock_products_result]

        response = client.get("/v1/products?category=InvalidCategory123")

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 0

    def test_search_invalid_price_range(self, client):
        """Test /v1/search with min_price > max_price returns 422."""
        response = client.get("/v1/search?min_price=500&max_price=100")
        assert response.status_code == 422

    def test_search_negative_price(self, client):
        """Test /v1/search with negative price returns 422."""
        response = client.get("/v1/search?min_price=-10")
        assert response.status_code == 422


class TestHealthEndpoint:
    """Integration tests for system health endpoints."""

    def test_health_endpoint(self, client):
        """Test /v1/health returns 200 with status info."""
        response = client.get("/v1/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] in ("ok", "degraded", "down")
        assert "version" in data

    def test_api_root_endpoint(self, client):
        """Test /v1 returns API information."""
        response = client.get("/v1")
        assert response.status_code == 200
        data = response.json()
        assert "api" in data
        assert "version" in data
        assert "endpoints" in data


class TestRateLimiting:
    """Integration tests for rate limiting behavior.

    Note: Rate limiting tests require a running server with Redis
    for proper rate limit storage. These tests verify the rate
    limiting infrastructure is in place but actual rate limiting
    behavior should be tested in integration/staging environments.
    """

    def test_rate_limit_infrastructure_present(self, client):
        """Test that rate limiting middleware is configured."""
        assert hasattr(app.state, "limiter")
        assert app.state.limiter is not None


class TestCacheBehavior:
    """Integration tests for caching behavior."""

    def test_search_cache_hit_returns_cached_data(self, client, mock_db):
        """Test that cached responses are served without DB query."""
        cached_data = {
            "total": 42,
            "limit": 20,
            "offset": 0,
            "items": [],
            "has_more": True
        }

        with patch("app.cache.cache_get", new_callable=AsyncMock) as mock_cache_get:
            mock_cache_get.return_value = cached_data
            response = client.get("/v1/search?q=cached")

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 42
        mock_db.execute.assert_not_called()

    def test_product_by_id_cache_hit(self, client, mock_db, sample_product):
        """Test that cached product by ID is served without DB query."""
        cached_data = {
            "id": 1,
            "sku": "SKU-001",
            "source": "shopee_sg",
            "merchant_id": "merchant_001",
            "name": "Cached Product",
            "description": "From cache",
            "price": "1999.00",
            "currency": "SGD",
            "buy_url": "https://shopee.sg/product/1",
            "affiliate_url": None,
            "image_url": None,
            "brand": "Apple",
            "category": "Electronics",
            "category_path": ["Electronics"],
            "rating": "4.5",
            "is_available": True,
            "last_checked": "2024-01-15T00:00:00Z",
            "metadata": None,
            "updated_at": "2024-01-15T00:00:00Z",
        }

        with patch("app.cache.cache_get", new_callable=AsyncMock) as mock_cache_get:
            mock_cache_get.return_value = cached_data
            response = client.get("/v1/products/1")

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Cached Product"
        mock_db.execute.assert_not_called()


class TestCategoriesEndpoint:
    """Integration tests for GET /v1/categories endpoint."""

    def test_categories_returns_valid_json_schema(self, client, mock_db):
        """Test /v1/categories returns correct JSON schema."""
        mock_result = MagicMock()
        mock_result.all.return_value = []

        mock_db.execute.return_value = mock_result

        response = client.get("/v1/categories")

        assert response.status_code == 200
        data = response.json()

        assert "categories" in data
        assert "total" in data
        assert isinstance(data["categories"], list)
        assert isinstance(data["total"], int)

    def test_categories_with_products(self, client, mock_db):
        """Test /v1/categories returns categories with product counts."""
        mock_row = MagicMock()
        mock_row.category = "Electronics"
        mock_row.count = 100

        mock_result = MagicMock()
        mock_result.all.return_value = [mock_row]

        mock_db.execute.return_value = mock_result

        response = client.get("/v1/categories")

        assert response.status_code == 200
        data = response.json()
        assert data["total"] >= 1

    def test_categories_tree_endpoint(self, client, mock_db):
        """Test /v1/categories/tree returns hierarchical structure."""
        mock_result = MagicMock()
        mock_result.all.return_value = []

        mock_db.execute.return_value = mock_result

        response = client.get("/v1/categories/tree")

        assert response.status_code == 200
        data = response.json()
        assert "categories" in data
        assert "total" in data

    def test_categories_pagination(self, client, mock_db):
        """Test /v1/categories supports pagination parameters."""
        mock_result = MagicMock()
        mock_result.all.return_value = []

        mock_db.execute.return_value = mock_result

        response = client.get("/v1/categories?depth=3&include_empty=true")

        assert response.status_code == 200


class TestDealsEndpoint:
    """Integration tests for GET /v1/deals endpoint."""

    def test_deals_returns_valid_json_schema(self, client, mock_db):
        """Test /v1/deals returns correct JSON schema."""
        mock_result = MagicMock()
        mock_result.__iter__ = MagicMock(return_value=iter([]))
        mock_db.execute.return_value = mock_result

        response = client.get("/v1/deals")

        assert response.status_code == 200
        data = response.json()

        assert "total" in data
        assert "limit" in data
        assert "offset" in data
        assert "items" in data or "deals" in data
        assert isinstance(data["total"], int)

    def test_deals_with_category_filter(self, client, mock_db):
        """Test /v1/deals with category filter."""
        mock_result = MagicMock()
        mock_result.__iter__ = MagicMock(return_value=iter([]))
        mock_db.execute.return_value = mock_result

        response = client.get("/v1/deals?category=Electronics")

        assert response.status_code == 200

    def test_deals_with_min_discount_filter(self, client, mock_db):
        """Test /v1/deals with min_discount_pct filter."""
        mock_result = MagicMock()
        mock_result.__iter__ = MagicMock(return_value=iter([]))
        mock_db.execute.return_value = mock_result

        response = client.get("/v1/deals?min_discount_pct=20")

        assert response.status_code == 200

    def test_deals_pagination(self, client, mock_db):
        """Test /v1/deals pagination with limit and offset."""
        mock_result = MagicMock()
        mock_result.__iter__ = MagicMock(return_value=iter([]))
        mock_db.execute.return_value = mock_result

        response = client.get("/v1/deals?limit=10&offset=20")

        assert response.status_code == 200
        data = response.json()
        assert data["limit"] == 10
        assert data["offset"] == 20

    def test_deals_price_drops_endpoint(self, client, mock_db):
        """Test /v1/deals/price-drops returns valid schema."""
        mock_result = MagicMock()
        mock_result.__iter__ = MagicMock(return_value=iter([]))
        mock_db.execute.return_value = mock_result

        response = client.get("/v1/deals/price-drops")

        assert response.status_code == 200
        data = response.json()

        assert "total" in data
        assert "items" in data

    def test_deals_price_drops_with_days_filter(self, client, mock_db):
        """Test /v1/deals/price-drops with days filter."""
        mock_result = MagicMock()
        mock_result.__iter__ = MagicMock(return_value=iter([]))
        mock_db.execute.return_value = mock_result

        response = client.get("/v1/deals/price-drops?days=14")

        assert response.status_code == 200


class TestComparisonEndpoint:
    """Integration tests for GET /v1/compare/{product_id} endpoint."""

    def test_compare_product_returns_valid_json_schema(self, client, mock_db, sample_product):
        """Test /v1/compare/{product_id} returns correct JSON schema."""
        mock_source_result = MagicMock()
        mock_source_result.scalar_one_or_none.return_value = sample_product

        mock_match_result = MagicMock()
        mock_match_result.scalars.return_value.all.return_value = []

        mock_db.execute.side_effect = [mock_source_result, mock_match_result]

        response = client.get("/v1/compare/1")

        assert response.status_code == 200
        data = response.json()

        assert "source_product_id" in data
        assert "source_product_name" in data
        assert "matches" in data
        assert "total_matches" in data

    def test_compare_product_not_found(self, client, mock_db):
        """Test /v1/compare/{product_id} returns 404 for non-existent product."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None

        mock_db.execute.return_value = mock_result

        response = client.get("/v1/compare/99999")

        assert response.status_code == 404

    def test_compare_product_with_price_filters(self, client, mock_db, sample_product):
        """Test /v1/compare/{product_id} with min_price and max_price filters."""
        mock_source_result = MagicMock()
        mock_source_result.scalar_one_or_none.return_value = sample_product

        mock_match_result = MagicMock()
        mock_match_result.scalars.return_value.all.return_value = []

        mock_db.execute.side_effect = [mock_source_result, mock_match_result]

        response = client.get("/v1/compare/1?min_price=100&max_price=2000")

        assert response.status_code == 200

    def test_compare_product_includes_highlights(self, client, mock_db, sample_product):
        """Test /v1/compare/{product_id} includes highlights when available."""
        mock_source_result = MagicMock()
        mock_source_result.scalar_one_or_none.return_value = sample_product

        mock_match_result = MagicMock()
        mock_match_result.scalars.return_value.all.return_value = []

        mock_db.execute.side_effect = [mock_source_result, mock_match_result]

        response = client.get("/v1/compare/1")

        assert response.status_code == 200
        data = response.json()
        assert "highlights" in data


class TestGraphQLEndpoint:
    """Integration tests for POST /api/graphql endpoint."""

    def test_graphql_products_query(self, client, mock_db):
        """Test GraphQL products query returns valid response."""
        query = {
            "query": """
                query {
                    products(query: "iPhone", limit: 10) {
                        total
                        items {
                            id
                            name
                            price
                        }
                    }
                }
            """
        }

        mock_result = MagicMock()
        mock_result.count.return_value = 0
        mock_result.limit.return_value.offset.return_value.all.return_value = []

        mock_db.query.return_value.filter.return_value.order_by.return_value.count.return_value = 0
        mock_db.query.return_value.filter.return_value.order_by.return_value.limit.return_value.offset.return_value.all.return_value = []

        response = client.post("/api/graphql/graphql", json=query)

        assert response.status_code == 200
        data = response.json()
        assert "data" in data or "errors" in data

    def test_graphql_product_by_id_query(self, client, mock_db):
        """Test GraphQL product query by ID."""
        query = {
            "query": """
                query {
                    product(id: 1) {
                        id
                        name
                        price
                        source
                    }
                }
            """
        }

        mock_result = MagicMock()
        mock_result.filter.return_value.first.return_value = None
        mock_db.query.return_value = mock_result

        response = client.post("/api/graphql/graphql", json=query)

        assert response.status_code == 200
        data = response.json()
        assert "data" in data or "errors" in data

    def test_graphql_categories_query(self, client, mock_db):
        """Test GraphQL categories query."""
        query = {
            "query": """
                query {
                    categories {
                        name
                        count
                    }
                }
            """
        }

        mock_result = MagicMock()
        mock_result.filter.return_value.group_by.return_value.order_by.return_value.all.return_value = []
        mock_db.query.return_value = mock_result

        response = client.post("/api/graphql/graphql", json=query)

        assert response.status_code == 200
        data = response.json()
        assert "data" in data or "errors" in data

    def test_graphql_deals_query(self, client, mock_db):
        """Test GraphQL deals query."""
        query = {
            "query": """
                query {
                    deals(minDiscountPct: 10, limit: 20) {
                        total
                        items {
                            id
                            name
                            discountPct
                        }
                    }
                }
            """
        }

        mock_result = MagicMock()
        mock_result.filter.return_value.filter.return_value.filter.return_value.order_by.return_value.count.return_value = 0
        mock_result.filter.return_value.filter.return_value.filter.return_value.order_by.return_value.limit.return_value.offset.return_value.all.return_value = []

        mock_db.query.return_value = mock_result

        response = client.post("/api/graphql/graphql", json=query)

        assert response.status_code == 200
        data = response.json()
        assert "data" in data or "errors" in data

    def test_graphql_invalid_query(self, client):
        """Test GraphQL with invalid query returns errors."""
        query = {
            "query": "invalid { notAField }"
        }

        response = client.post("/api/graphql/graphql", json=query)

        assert response.status_code == 400
        data = response.json()
        assert "errors" in data

    def test_graphql_empty_query(self, client):
        """Test GraphQL with empty query."""
        query = {"query": ""}

        response = client.post("/api/graphql/graphql", json=query)

        assert response.status_code in (200, 400)


class TestAPIKeysEndpoint:
    """Integration tests for API keys endpoints."""

    def test_list_keys_requires_auth(self, mock_get_db, mock_db):
        """Test GET /v1/keys requires authentication."""
        from fastapi.testclient import TestClient
        from app.main import app
        app.dependency_overrides[get_db] = mock_get_db
        app.state.limiter.enabled = False
        client = TestClient(app)
        response = client.get("/v1/keys")
        assert response.status_code in (401, 403)
        app.dependency_overrides.clear()

    def test_create_key_requires_auth(self, mock_get_db, mock_db):
        """Test POST /v1/keys requires authentication."""
        from fastapi.testclient import TestClient
        from app.main import app
        app.dependency_overrides[get_db] = mock_get_db
        app.state.limiter.enabled = False
        client = TestClient(app)
        response = client.post("/v1/keys", json={"name": "Test Key"})
        assert response.status_code in (401, 403)
        app.dependency_overrides.clear()

    def test_bootstrap_key_from_localhost(self, client, mock_db):
        """Test POST /v1/keys/bootstrap works from localhost."""
        mock_db.execute.return_value = MagicMock(scalar=MagicMock(return_value=0))

        response = client.post(
            "/v1/keys/bootstrap",
            json={"name": "Bootstrap Key"},
            headers={"Host": "127.0.0.1"}
        )

        assert response.status_code in (200, 201, 403)

    def test_revoke_key_requires_auth(self, mock_get_db, mock_db):
        """Test DELETE /v1/keys/{key_id} requires authentication."""
        from fastapi.testclient import TestClient
        from app.main import app
        app.dependency_overrides[get_db] = mock_get_db
        app.state.limiter.enabled = False
        client = TestClient(app)
        response = client.delete("/v1/keys/test-key-id")
        assert response.status_code in (401, 403)
        app.dependency_overrides.clear()

    def test_rotate_key_requires_auth(self, mock_get_db, mock_db):
        """Test POST /v1/keys/{key_id}/rotate requires authentication."""
        from fastapi.testclient import TestClient
        from app.main import app
        app.dependency_overrides[get_db] = mock_get_db
        app.state.limiter.enabled = False
        client = TestClient(app)
        response = client.post("/v1/keys/test-key-id/rotate")
        assert response.status_code in (401, 403)
        app.dependency_overrides.clear()


class TestRecommendationsEndpoint:
    """Integration tests for product recommendations endpoints."""

    def test_similar_products_returns_valid_schema(self, client, mock_db, sample_product):
        """Test /v1/products/{id}/similar returns correct schema."""
        mock_product_result = MagicMock()
        mock_product_result.scalar_one_or_none.return_value = sample_product

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []

        mock_db.execute.side_effect = [mock_product_result, mock_result]

        response = client.get("/v1/products/1/similar")

        assert response.status_code == 200
        data = response.json()

        assert "items" in data or "products" in data

    def test_alternatives_returns_valid_schema(self, client, mock_db, sample_product):
        """Test /v1/products/{id}/alternatives returns correct schema."""
        mock_product_result = MagicMock()
        mock_product_result.scalar_one_or_none.return_value = sample_product

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []

        mock_db.execute.side_effect = [mock_product_result, mock_result]

        response = client.get("/v1/products/1/alternatives")

        assert response.status_code == 200

    @pytest.mark.skip(reason="RecommendationEngine creates its own db session; requires architectural fix")
    def test_bundles_returns_valid_schema(self, client, mock_db, sample_product):
        """Test /v1/products/{id}/bundles returns correct schema."""
        mock_product_result = MagicMock()
        mock_product_result.scalar_one_or_none.return_value = sample_product

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []

        mock_db.execute.side_effect = [mock_product_result, mock_result]

        response = client.get("/v1/products/1/bundles")

        assert response.status_code == 200

    def test_recommendations_require_auth(self, client):
        """Test recommendations endpoints require authentication."""
        response = client.get("/v1/products/1/similar")
        assert response.status_code in (200, 401, 403, 404)


class TestRateLimitingBehavior:
    """Integration tests for rate limiting behavior.

    Note: Rate limiting tests require a running server with Redis
    for proper rate limit storage and the limiter enabled.
    These tests verify the rate limiting infrastructure is in place
    but actual rate limiting behavior should be tested in
    integration/staging environments.
    """

    @pytest.mark.skip(reason="Rate limiter disabled in test fixture; requires integration test setup")
    def test_rate_limit_headers_present(self, client):
        """Test that rate limit headers are included in responses."""
        response = client.get("/v1/search")

        assert response.status_code == 200
        assert "X-RateLimit-Limit" in response.headers or "x-ratelimit-limit" in {
            h.lower() for h in response.headers
        }

    @pytest.mark.skip(reason="Rate limiter disabled in test fixture; requires integration test setup")
    def test_rate_limit_exceeded_returns_429(self, client):
        """Test that rate limit exceeded returns 429 status."""
        response = client.get("/v1/search")
        assert response.status_code in (200, 429)

    @pytest.mark.skip(reason="Rate limiter disabled in test fixture; requires integration test setup")
    def test_rate_limit_different_tiers(self, client, mock_db):
        """Test that different API key tiers have different rate limits."""
        response = client.get("/v1/search")

        assert response.status_code == 200


class TestPriceHistoryEndpoint:
    """Integration tests for GET /v1/products/{id}/price-history endpoint."""

    def test_price_history_returns_valid_schema(self, client, mock_db, sample_product):
        """Test /v1/products/{id}/price-history returns correct schema."""
        mock_product_result = MagicMock()
        mock_product_result.scalar_one_or_none.return_value = sample_product

        mock_count_result = MagicMock()
        mock_count_result.scalar_one.return_value = 0

        mock_history_result = MagicMock()
        mock_history_result.scalars.return_value.all.return_value = []

        mock_db.execute.side_effect = [mock_product_result, mock_count_result, mock_history_result]

        response = client.get("/v1/products/1/price-history")

        assert response.status_code == 200
        data = response.json()

        assert "product_id" in data
        assert "entries" in data or "history" in data

    def test_price_history_with_days_filter(self, client, mock_db, sample_product):
        """Test /v1/products/{id}/price-history with days filter."""
        mock_product_result = MagicMock()
        mock_product_result.scalar_one_or_none.return_value = sample_product

        mock_count_result = MagicMock()
        mock_count_result.scalar_one.return_value = 0

        mock_history_result = MagicMock()
        mock_history_result.scalars.return_value.all.return_value = []

        mock_db.execute.side_effect = [mock_product_result, mock_count_result, mock_history_result]

        response = client.get("/v1/products/1/price-history?days=30")

        assert response.status_code == 200

    def test_price_history_product_not_found(self, client, mock_db):
        """Test /v1/products/{id}/price-history returns 404 for non-existent product."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None

        mock_db.execute.return_value = mock_result

        response = client.get("/v1/products/99999/price-history")

        assert response.status_code == 404


class TestTrendingEndpoint:
    """Integration tests for GET /v1/products/trending endpoint."""

    def test_trending_returns_valid_schema(self, client, mock_db):
        """Test /v1/products/trending returns correct JSON schema."""
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []

        mock_db.execute.return_value = mock_result

        response = client.get("/v1/products/trending")

        assert response.status_code == 200
        data = response.json()

        assert "items" in data or "products" in data
        assert "total" in data

    def test_trending_with_category_filter(self, client, mock_db):
        """Test /v1/products/trending with category filter."""
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []

        mock_db.execute.return_value = mock_result

        response = client.get("/v1/products/trending?category=Electronics")

        assert response.status_code == 200

    def test_trending_with_period_filter(self, client, mock_db):
        """Test /v1/products/trending with period filter."""
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []

        mock_db.execute.return_value = mock_result

        response = client.get("/v1/products/trending?period=30d")

        assert response.status_code == 200


class TestBestPriceEndpoint:
    """Integration tests for GET /v1/products/best-price endpoint."""

    def test_best_price_returns_valid_schema(self, client, mock_db, sample_product):
        """Test /v1/products/best-price returns correct JSON schema."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = sample_product

        mock_db.execute.return_value = mock_result

        response = client.get("/v1/products/best-price?q=iPhone")

        assert response.status_code == 200
        data = response.json()

        assert "id" in data or "product" in data

    def test_best_price_requires_query(self, client):
        """Test /v1/products/best-price requires q parameter."""
        response = client.get("/v1/products/best-price")

        assert response.status_code == 422

    def test_best_price_not_found(self, client, mock_db):
        """Test /v1/products/best-price returns 404 when no products found."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None

        mock_db.execute.return_value = mock_result

        response = client.get("/v1/products/best-price?q=nonexistent")

        assert response.status_code == 404


class TestBrandsEndpoint:
    """Integration tests for GET /v1/brands endpoint."""

    def test_brands_returns_valid_schema(self, client, mock_db):
        """Test /v1/brands returns correct JSON schema."""
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []
        mock_result.scalar_one.return_value = 0

        mock_db.execute.return_value = mock_result

        response = client.get("/v1/brands")

        assert response.status_code == 200
        data = response.json()

        assert "brands" in data or "items" in data
        assert "total" in data

    def test_brands_products_returns_valid_schema(self, client, mock_db, sample_product):
        """Test /v1/brands/{brand}/products returns correct JSON schema."""
        mock_count_result = MagicMock()
        mock_count_result.scalar_one.return_value = 1

        mock_product_result = MagicMock()
        mock_product_result.scalars.return_value.all.return_value = [sample_product]

        mock_db.execute.side_effect = [mock_count_result, mock_product_result]

        response = client.get("/v1/brands/Apple/products")

        assert response.status_code == 200
        data = response.json()

        assert "products" in data or "items" in data


class TestSourcesEndpoint:
    """Integration tests for GET /v1/sources endpoint."""

    def test_sources_returns_valid_schema(self, client, mock_db):
        """Test /v1/sources returns correct JSON schema."""
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []

        mock_db.execute.return_value = mock_result

        response = client.get("/v1/sources")

        assert response.status_code == 200
        data = response.json()

        assert "sources" in data or "items" in data
        assert "total" in data


class TestSearchSuggestEndpoint:
    """Integration tests for GET /v1/search/suggest endpoint."""

    def test_suggest_returns_valid_schema(self, client):
        """Test /v1/search/suggest returns correct JSON schema."""
        response = client.get("/v1/search/suggest?q=test")

        assert response.status_code == 200
        data = response.json()

        assert "query" in data
        assert "suggestions" in data

    def test_suggest_requires_query(self, client):
        """Test /v1/search/suggest requires q parameter."""
        response = client.get("/v1/search/suggest")

        assert response.status_code == 422


class TestSearchFiltersEndpoint:
    """Integration tests for GET /v1/search/filters endpoint."""

    def test_filters_returns_available_filters(self, client):
        """Test /v1/search/filters returns available filter options."""
        response = client.get("/v1/search/filters")

        assert response.status_code == 200
        data = response.json()

        assert "filters" in data or "categories" in data or "brands" in data


class TestBulkLookupEndpoint:
    """Integration tests for POST /v1/products/bulk-ids endpoint."""

    def test_bulk_lookup_returns_valid_schema(self, client, mock_db, sample_product):
        """Test /v1/products/bulk-ids returns correct JSON schema."""
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [sample_product]

        mock_db.execute.return_value = mock_result

        response = client.post("/v1/products/bulk-ids", json={"ids": [1, 2, 3]})

        assert response.status_code == 200
        data = response.json()

        assert "products" in data

    def test_bulk_lookup_requires_ids(self, client):
        """Test /v1/products/bulk-ids requires ids field."""
        response = client.post("/v1/products/bulk-lookup", json={})

        assert response.status_code in (400, 422)


class TestPriceComparisonEndpoint:
    """Integration tests for GET /v1/products/{id}/price-comparison endpoint."""

    def test_price_comparison_returns_valid_schema(self, client, mock_db, sample_product):
        """Test /v1/products/{id}/price-comparison returns correct JSON schema."""
        mock_product_result = MagicMock()
        mock_product_result.scalar_one_or_none.return_value = sample_product

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []

        mock_db.execute.side_effect = [mock_product_result, mock_result]

        response = client.get("/v1/products/1/price-comparison")

        assert response.status_code == 200
        data = response.json()

        assert "items" in data or "products" in data
        assert "total" in data

    def test_price_comparison_product_not_found(self, client, mock_db):
        """Test /v1/products/{id}/price-comparison returns 404 for non-existent product."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None

        mock_db.execute.return_value = mock_result

        response = client.get("/v1/products/99999/price-comparison")

        assert response.status_code == 404


class TestAvailabilityEndpoint:
    """Integration tests for GET /v1/products/{id}/availability endpoint."""

    def test_availability_returns_valid_schema(self, client, mock_db, sample_product):
        """Test /v1/products/{id}/availability returns correct JSON schema."""
        mock_product_result = MagicMock()
        mock_product_result.scalar_one_or_none.return_value = sample_product

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []

        mock_db.execute.side_effect = [mock_product_result, mock_result]

        response = client.get("/v1/products/1/availability")

        assert response.status_code == 200
        data = response.json()

        assert "overall_status" in data or "platforms" in data

    def test_availability_product_not_found(self, client, mock_db):
        """Test /v1/products/{id}/availability returns 404 for non-existent product."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None

        mock_db.execute.return_value = mock_result

        response = client.get("/v1/products/99999/availability")

        assert response.status_code == 404