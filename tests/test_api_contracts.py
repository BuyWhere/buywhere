"""API contract tests — validate responses match OpenAPI spec.

Run with: python -m pytest tests/test_api_contracts.py -v
"""

import sys
import yaml
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, "/home/paperclip/buywhere-api")

from app.main import app
from app.models.product import ApiKey, Product
from app.auth import get_current_api_key
from app.database import get_db


OPENSEARCH_YAML_PATH = "/home/paperclip/buywhere-api/openapi.yaml"


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
    mock_result.fetchall.return_value = [
        ("iphone 15", 100),
        ("iphone case", 50),
    ]
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
def client(mock_get_db, mock_get_api_key):
    app.dependency_overrides[get_db] = mock_get_db
    app.dependency_overrides[get_current_api_key] = mock_get_api_key
    original_enabled = app.state.limiter.enabled
    app.state.limiter.enabled = False

    mock_cache_get = AsyncMock(return_value=None)
    mock_cache_set = AsyncMock()

    with patch("app.cache.cache_get", mock_cache_get), \
         patch("app.cache.cache_set", mock_cache_set):
        yield TestClient(app)

    app.state.limiter.enabled = original_enabled
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def mock_all_limiters():
    with patch("app.routers.products.limiter.limit", lambda *args, **kwargs: lambda f: f), \
         patch("app.routers.search.limiter.limit", lambda *args, **kwargs: lambda f: f), \
         patch("app.routers.categories.limiter.limit", lambda *args, **kwargs: lambda f: f), \
         patch("app.routers.deals.limiter.limit", lambda *args, **kwargs: lambda f: f), \
         patch("app.routers.status.limiter.limit", lambda *args, **kwargs: lambda f: f), \
         patch("app.routers.metrics.limiter.limit", lambda *args, **kwargs: lambda f: f), \
         patch("app.routers.ingest.limiter.limit", lambda *args, **kwargs: lambda f: f), \
         patch("app.routers.ingestion.limiter.limit", lambda *args, **kwargs: lambda f: f):
        yield


def load_openapi_spec():
    with open(OPENSEARCH_YAML_PATH, "r") as f:
        return yaml.safe_load(f)


def get_testable_endpoints(spec):
    """Return list of endpoints that can be tested without complex setup."""
    endpoints = []
    for path, path_item in spec["paths"].items():
        for method, operation in path_item.items():
            if method not in ("get", "post", "put", "patch", "delete"):
                continue
            if "responses" not in operation:
                continue
            endpoints.append({
                "method": method.upper(),
                "path": path,
                "operation": operation,
            })
    return endpoints


def resolve_schema_ref(spec, ref):
    """Resolve a $ref in the OpenAPI spec to the actual schema."""
    if not ref.startswith("#/components/schemas/"):
        return None
    schema_name = ref.split("/")[-1]
    return spec.get("components", {}).get("schemas", {}).get(schema_name)


class TestHealthEndpoint:
    """Tests for /api/v1/health endpoint."""

    def test_health_returns_200_with_valid_schema(self, client):
        response = client.get("/api/v1/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "version" in data
        assert "environment" in data


class TestAPIRootEndpoint:
    """Tests for /api/v1 endpoint."""

    def test_v1_root_returns_200(self, client):
        response = client.get("/api/v1")
        assert response.status_code == 200
        data = response.json()
        assert data["api"] == "BuyWhere Catalog API"
        assert data["version"] == "v1"
        assert "endpoints" in data
        assert data["auth"] == "Bearer token required (API key)"
        assert data["docs"] == "/api/docs"


class TestChangelogEndpoint:
    """Tests for /api/v1/changelog endpoint."""

    def test_changelog_returns_structured_release_history(self, client):
        response = client.get("/api/v1/changelog")
        assert response.status_code == 200
        assert response.headers["x-api-version"] == "1.0"

        data = response.json()
        assert data["api_version"] == "1.0"
        assert len(data["releases"]) >= 1

        latest_release = data["releases"][0]
        assert latest_release["version"] == "1.0.0"
        assert latest_release["date"] == "2026-04-04"
        assert len(latest_release["changes"]) > 0
        assert latest_release["changes"][0]["category"] == "Added"
        assert "description" in latest_release["changes"][0]

    def test_unsupported_accept_version_still_returns_api_version_header(self, client):
        response = client.get("/api/v1/changelog", headers={"Accept-Version": "2"})
        assert response.status_code == 400
        assert response.headers["x-api-version"] == "1.0"
        assert response.json()["error"]["code"] == "UNSUPPORTED_VERSION"


class TestCategoriesEndpoints:
    """Tests for /api/v1/categories endpoints."""

    def test_categories_returns_200(self, client, mock_db):
        mock_result = MagicMock()
        mock_result.__iter__ = MagicMock(return_value=iter([]))
        mock_db.execute.return_value = mock_result

        response = client.get("/api/v1/categories")
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/json"

        data = response.json()
        assert "categories" in data
        assert "total" in data
        assert isinstance(data["categories"], list)


class TestDealsEndpoints:
    """Tests for /api/v1/deals endpoints."""

    def test_deals_returns_200(self, client, mock_db):
        mock_result = MagicMock()
        mock_result.__iter__ = MagicMock(return_value=iter([]))
        mock_db.execute.return_value = mock_result

        response = client.get("/api/v1/deals")
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/json"

        data = response.json()
        assert "deals" in data or "items" in data or "products" in data

    def test_deals_price_drops_returns_200(self, client, mock_db):
        mock_result = MagicMock()
        mock_result.__iter__ = MagicMock(return_value=iter([]))
        mock_db.execute.return_value = mock_result

        response = client.get("/api/v1/deals/price-drops")
        assert response.status_code == 200


class TestAlertsSpec:
    """OpenAPI checks for /api/v1/alerts endpoints."""

    def test_alerts_paths_exist_in_openapi_spec(self):
        spec = load_openapi_spec()
        assert "/v1/alerts" in spec["paths"]
        assert "/v1/alerts/{alert_id}" in spec["paths"]

    def test_alerts_schemas_exist_in_openapi_spec(self):
        spec = load_openapi_spec()
        schemas = spec["components"]["schemas"]
        assert "AlertCreateRequest" in schemas
        assert "AlertResponse" in schemas
        assert "AlertListResponse" in schemas


class TestIngestEndpoint:
    """Tests for /api/v1/ingest/products endpoint."""

    def test_ingest_endpoint_accepts_post(self, client, mock_db):
        mock_db.commit = AsyncMock()

        payload = {
            "products": [{
                "sku": "TEST-SKU-001",
                "merchant_id": "merchant_test",
                "title": "Test Product",
                "price": 99.99,
                "currency": "SGD",
                "url": "https://example.com/product",
                "source": "test_source"
            }],
            "source": "test"
        }

        response = client.post("/api/v1/ingest/products", json=payload)
        assert response.status_code in (200, 201, 401, 403)


class TestOpenAPISchemaCompliance:
    """Full OpenAPI schema validation tests."""

    @pytest.fixture(scope="class")
    def spec(self):
        return load_openapi_spec()

    def test_openapi_spec_loads(self, spec):
        """Verify OpenAPI spec can be loaded."""
        assert spec is not None
        assert "openapi" in spec
        assert "info" in spec
        assert "paths" in spec
        assert "components" in spec

    def test_all_paths_have_schemas(self, spec):
        """Verify all paths have at least one response schema defined."""
        missing_schemas = []
        for path, path_item in spec["paths"].items():
            for method, operation in path_item.items():
                if method not in ("get", "post", "put", "patch", "delete"):
                    continue
                responses = operation.get("responses", {})
                if not responses:
                    missing_schemas.append(f"{method.upper()} {path}")
                has_json_response = False
                for status_code, response_def in responses.items():
                    content = response_def.get("content", {})
                    if "application/json" in content:
                        has_json_response = True
                        break
                if not has_json_response and responses:
                    missing_schemas.append(f"{method.upper()} {path} (no JSON response)")
        assert len(missing_schemas) == 0, f"Paths missing schemas: {missing_schemas}"

    def test_product_list_response_has_required_fields(self, spec):
        """Verify ProductListResponse schema has pagination fields."""
        schema = resolve_schema_ref(spec, "#/components/schemas/ProductListResponse")
        assert schema is not None, "ProductListResponse schema not found"
        required = schema.get("required", [])
        assert "total" in required
        assert "limit" in required
        assert "offset" in required
        assert "items" in required

    def test_product_response_required_fields(self, spec):
        """Verify ProductResponse schema has all required fields."""
        schema = resolve_schema_ref(spec, "#/components/schemas/ProductResponse")
        assert schema is not None, "ProductResponse schema not found"
        required = schema.get("required", [])
        assert "id" in required
        assert "sku" in required
        assert "source" in required
        assert "merchant_id" in required
        assert "name" in required
        assert "price" in required
        assert "currency" in required
        assert "buy_url" in required
        assert "is_available" in required
        assert "updated_at" in required

    def test_category_response_has_required_fields(self, spec):
        """Verify CategoryResponse schema has required fields."""
        schema = resolve_schema_ref(spec, "#/components/schemas/CategoryResponse")
        assert schema is not None, "CategoryResponse schema not found"
        required = schema.get("required", [])
        assert "categories" in required
        assert "total" in required

    def test_all_endpoint_paths_are_valid(self, spec):
        """Verify all endpoint paths are valid strings."""
        for path in spec["paths"].keys():
            assert path.startswith("/"), f"Invalid path: {path}"

    def test_all_schemas_have_type_or_reference(self, spec):
        """Verify all schema properties have type or $ref."""
        schemas = spec.get("components", {}).get("schemas", {})
        issues = []
        for schema_name, schema_def in schemas.items():
            if not isinstance(schema_def, dict):
                continue
            if "properties" in schema_def:
                for prop_name, prop_def in schema_def["properties"].items():
                    if not isinstance(prop_def, dict):
                        continue
                    if "$ref" not in prop_def and "type" not in prop_def:
                        issues.append(f"{schema_name}.{prop_name}")
        assert len(issues) == 0, f"Properties missing type/ref: {issues}"

    def test_operation_ids_are_unique(self, spec):
        """Verify operationIds are unique across all endpoints."""
        operation_ids = []
        for path, path_item in spec["paths"].items():
            for method, operation in path_item.items():
                if method not in ("get", "post", "put", "patch", "delete"):
                    continue
                op_id = operation.get("operationId")
                if op_id:
                    operation_ids.append(op_id)
        duplicates = [x for x in operation_ids if operation_ids.count(x) > 1]
        assert len(duplicates) == 0, f"Duplicate operationIds: {set(duplicates)}"

    def test_rate_limit_responses_defined(self, spec):
        """Verify rate limited responses are properly defined."""
        rate_limited_paths = []
        for path, path_item in spec["paths"].items():
            for method, operation in path_item.items():
                if method not in ("get", "post", "put", "patch", "delete"):
                    continue
                responses = operation.get("responses", {})
                if "429" in responses:
                    rate_limited_paths.append(f"{method.upper()} {path}")
        assert len(rate_limited_paths) > 0, "No rate limited responses defined"

    def test_error_responses_have_schema(self, spec):
        """Verify error responses (4xx, 5xx) are properly defined."""
        error_responses = []
        for path, path_item in spec["paths"].items():
            for method, operation in path_item.items():
                if method not in ("get", "post", "put", "patch", "delete"):
                    continue
                responses = operation.get("responses", {})
                for status_code in responses.keys():
                    if status_code.startswith(("4", "5")):
                        error_responses.append(f"{method.upper()} {path} -> {status_code}")
        assert len(error_responses) > 0, "No error responses defined"


class TestSearchSuggestionsEndpoint:
    """Tests for /api/v1/search/suggest endpoint."""

    def test_suggest_returns_200_with_mock_auth(self, client, mock_db):
        """Verify /api/v1/search/suggest returns 200 with mock auth."""
        response = client.get("/api/v1/search/suggest?q=test")
        assert response.status_code == 200
        data = response.json()
        assert "query" in data
        assert "suggestions" in data
        assert "total" in data


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
