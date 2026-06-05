"""
Live API endpoint regression tests — BUY-31302
Run against REGRESSION_BASE_URL (default: https://api.buywhere.ai)

Requirements:
    BUYWHERE_API_KEY or BUYWHERE_SMOKE_KEY must be set.
    pip install pytest requests

Usage:
    BUYWHERE_API_KEY=bw_xxx pytest tests/api/test_api_endpoints.py -v
    BUYWHERE_API_KEY=bw_xxx pytest tests/api/test_api_endpoints.py -v -m search
"""

import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REGRESSION_BASE_URL", "https://api.buywhere.ai").rstrip("/")
API_KEY = os.environ.get("BUYWHERE_API_KEY") or os.environ.get("BUYWHERE_SMOKE_KEY", "")

HEADERS = {"Authorization": f"Bearer {API_KEY}"} if API_KEY else {}
# CI: warn rather than skip when no key — lets us see the 401 in test output
NEEDS_AUTH = pytest.mark.skipif(not API_KEY, reason="BUYWHERE_API_KEY not set")


# ─────────────────────────────────────────────────────────────
# Search — core smoke tests (BUY-31302)
# ─────────────────────────────────────────────────────────────

@pytest.mark.search
def test_search_sg_iphone_200():
    """iPhone 15 Pro + SG must return HTTP 200 in <1s."""
    start = time.monotonic()
    r = requests.get(
        f"{BASE_URL}/v1/products/search",
        params={"q": "iPhone 15 Pro", "country": "SG", "limit": 5},
        headers=HEADERS,
        timeout=1,
    )
    elapsed_ms = (time.monotonic() - start) * 1000
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text[:200]}"
    body = r.json()
    results = body.get("results", body.get("items", []))
    assert len(results) >= 1, f"Expected ≥1 result, got {len(results)}"
    assert elapsed_ms < 1000, f"Response took {elapsed_ms:.0f}ms (limit: 1000ms)"


@pytest.mark.search
def test_search_us_laptop_200():
    """Laptop + US must return HTTP 200 in <1s (cold-cache regression)."""
    start = time.monotonic()
    r = requests.get(
        f"{BASE_URL}/v1/products/search",
        params={"q": "laptop", "country": "US", "limit": 5},
        headers=HEADERS,
        timeout=1,
    )
    elapsed_ms = (time.monotonic() - start) * 1000
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text[:200]}"
    body = r.json()
    results = body.get("results", body.get("items", []))
    assert len(results) >= 1, f"Expected ≥1 result, got {len(results)}"
    assert elapsed_ms < 1000, f"Response took {elapsed_ms:.0f}ms (limit: 1000ms)"


@pytest.mark.search
def test_search_no_auth_401():
    """Search without API key must return 401."""
    r = requests.get(
        f"{BASE_URL}/v1/products/search",
        params={"q": "test", "country": "SG", "limit": 1},
        timeout=5,
    )
    assert r.status_code == 401, f"Expected 401 without auth, got {r.status_code}"


@pytest.mark.search
def test_search_default_country_sg():
    """Search with no country param defaults to SG (not all 28M rows)."""
    r = requests.get(
        f"{BASE_URL}/v1/products/search",
        params={"q": "iPhone", "limit": 5},
        headers=HEADERS,
        timeout=2,
    )
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text[:200]}"
    body = r.json()
    results = body.get("results", body.get("items", []))
    # Results should be SG (default)
    for item in results:
        cc = item.get("country_code") or item.get("country", "")
        assert cc in ("SG", ""), f"Expected SG result, got country_code={cc!r}"


# ─────────────────────────────────────────────────────────────
# Health
# ─────────────────────────────────────────────────────────────

def test_health_ok():
    """Health endpoint must return 200."""
    r = requests.get(f"{BASE_URL}/health", timeout=5)
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"


def test_health_db_ok():
    """DB health endpoint must return 200."""
    r = requests.get(f"{BASE_URL}/health/db", timeout=10)
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    body = r.json()
    assert body.get("status") == "ok", f"Expected status=ok, got {body}"
