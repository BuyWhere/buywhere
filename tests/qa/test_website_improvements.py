"""Website Improvements QA Test Suite - BUY-4986

This suite validates the API endpoints supporting the website improvements
deployed from BUY-4957. Run with: pytest tests/qa/test_website_improvements.py -v

Items covered:
- Item 4: Agent Simulation (demo/resolve)
- Item 7: Reliability Metrics (demo/metrics)
- Item 10: Trust Layer / Comparison Feature (demo/compare)
"""

import pytest
from fastapi.testclient import TestClient
from app.main import app


@pytest.fixture
def client():
    """Test client fixture with rate limiting disabled."""
    # Disable rate limiting for test environment
    original_limiter_enabled = app.state.limiter.enabled
    app.state.limiter.enabled = False
    with TestClient(app) as test_client:
        yield test_client
    app.state.limiter.enabled = original_limiter_enabled


class TestAgentSimulation:
    """Tests for Item 4: Agent Simulation search box functionality."""

    def test_demo_resolve_returns_products(self, client):
        """Verify demo/resolve returns expected product structure."""
        response = client.get("/demo/resolve", params={"q": "water bottle"})
        assert response.status_code == 200
        data = response.json()
        assert "query" in data
        assert "products" in data
        assert "total_results" in data
        assert "latency_ms" in data
        assert data["query"] == "water bottle"
        assert data["total_results"] == 3

    def test_demo_resolve_product_schema(self, client):
        """Verify each product has required fields."""
        response = client.get("/demo/resolve", params={"q": "laptop"})
        assert response.status_code == 200
        data = response.json()
        for product in data["products"]:
            assert "id" in product
            assert "name" in product
            assert "price" in product
            assert "currency" in product
            assert "merchant" in product
            assert "buy_url" in product
            assert "buywhere_score" in product
            assert "confidence" in product

    def test_demo_resolve_latency_reasonable(self, client):
        """Verify latency is within acceptable bounds (<500ms)."""
        response = client.get("/demo/resolve", params={"q": "headphones"})
        assert response.status_code == 200
        data = response.json()
        assert data["latency_ms"] < 500

    def test_demo_resolve_buywhere_score_range(self, client):
        """Verify buywhere_score is 0-100."""
        response = client.get("/demo/resolve", params={"q": "phone"})
        assert response.status_code == 200
        data = response.json()
        for product in data["products"]:
            assert 0 <= product["buywhere_score"] <= 100

    def test_demo_resolve_confidence_range(self, client):
        """Verify confidence is 0-1."""
        response = client.get("/demo/resolve", params={"q": "camera"})
        assert response.status_code == 200
        data = response.json()
        for product in data["products"]:
            assert 0 <= product["confidence"] <= 1


class TestReliabilityMetrics:
    """Tests for Item 7: Reliability metrics display."""

    def test_demo_metrics_returns_all_fields(self, client):
        """Verify demo/metrics returns all required metric fields."""
        response = client.get("/demo/metrics")
        assert response.status_code == 200
        data = response.json()
        assert "latency_p50_ms" in data
        assert "latency_p95_ms" in data
        assert "uptime" in data
        assert "data_freshness" in data
        assert "accuracy" in data

    def test_demo_metrics_p50_less_than_p95(self, client):
        """P50 latency should be less than P95 latency."""
        response = client.get("/demo/metrics")
        assert response.status_code == 200
        data = response.json()
        assert data["latency_p50_ms"] < data["latency_p95_ms"]

    def test_demo_metrics_uptime_high(self, client):
        """Uptime should be >= 99.9%."""
        response = client.get("/demo/metrics")
        assert response.status_code == 200
        data = response.json()
        assert data["uptime"] >= 0.999

    def test_demo_metrics_accuracy_high(self, client):
        """Accuracy should be >= 90%."""
        response = client.get("/demo/metrics")
        assert response.status_code == 200
        data = response.json()
        assert data["accuracy"] >= 0.90

    def test_demo_metrics_data_freshness_format(self, client):
        """Data freshness should be a string like '2h' or '30m'."""
        response = client.get("/demo/metrics")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data["data_freshness"], str)
        assert len(data["data_freshness"]) >= 2


class TestComparisonFeature:
    """Tests for Item 10: Trust layer / comparison feature."""

    def test_demo_compare_returns_structure(self, client):
        """Verify demo/compare returns comparison structure."""
        response = client.get("/demo/compare")
        assert response.status_code == 200
        data = response.json()
        assert "title" in data
        assert "comparisons" in data
        assert len(data["comparisons"]) >= 5

    def test_demo_compare_metric_structure(self, client):
        """Verify each comparison entry has required fields."""
        response = client.get("/demo/compare")
        assert response.status_code == 200
        data = response.json()
        for entry in data["comparisons"]:
            assert "metric" in entry
            assert "scraping" in entry
            assert "buywhere" in entry
            assert "advantage" in entry

    def test_demo_compare_buywhere_advantages(self, client):
        """Verify BuyWhere shows advantages in all comparisons."""
        response = client.get("/demo/compare")
        assert response.status_code == 200
        data = response.json()
        for entry in data["comparisons"]:
            assert "BuyWhere" in entry["advantage"] or "buywhere" in entry["advantage"]


class TestGeneralSmokeTests:
    """General API smoke tests for the supporting endpoints."""

    def test_demo_endpoints_no_auth_required(self, client):
        """All demo endpoints should be publicly accessible without auth."""
        endpoints = [
            "/demo/resolve?q=test",
            "/demo/metrics",
            "/demo/compare",
        ]
        for endpoint in endpoints:
            response = client.get(endpoint)
            assert response.status_code == 200, f"Endpoint {endpoint} failed: {response.status_code}"

    def test_demo_resolve_special_characters(self, client):
        """Demo resolve should handle special characters in query."""
        response = client.get("/demo/resolve", params={"q": "best $50 product"})
        assert response.status_code == 200

    def test_demo_resolve_empty_query(self, client):
        """Demo resolve should require query parameter."""
        response = client.get("/demo/resolve")
        assert response.status_code == 422  # Validation error for missing required param