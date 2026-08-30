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


# ─────────────────────────────────────────────────────────────
# Ingest — BUY-43028 regression tests
#
# The /v1/ingest/runs and /v1/ingest/runs/:id endpoints query
# ingestion_runs.started_at (NOT created_at — that column does not
# exist in the table). Before the fix, GET /v1/ingest/runs/:id
# returned HTTP 500 with `{run_id: null, status: "failed",
# errors: [{error: "Unhandled ingest error: column \"created_at\"
# does not exist", code: "unhandled_error"}]}` even for valid
# run_ids, breaking the entire ingestion feedback loop and
# tricking callers into thinking POST had succeeded.
# ─────────────────────────────────────────────────────────────

import time as _time
import uuid as _uuid


@NEEDS_AUTH
@pytest.mark.ingest
def test_ingest_runs_get_by_id_returns_run_record():
    """Regression for BUY-43028: GET /v1/ingest/runs/:id must
    return the run record (started_at, not created_at)."""
    # 1. POST a small valid batch
    sku = f"regress-{_uuid.uuid4().hex[:12]}"
    r = requests.post(
        f"{BASE_URL}/v1/ingest/products",
        headers={**HEADERS, "Content-Type": "application/json"},
        json={
            "source": "regression_buy43028",
            "products": [
                {
                    "sku": sku,
                    "merchant_id": "m1",
                    "title": "BUY-43028 regression smoke",
                    "price": 1.0,
                    "currency": "SGD",
                    "url": "https://example.com/p",
                    "country_code": "SG",
                }
            ],
        },
        timeout=30,
    )
    assert r.status_code in (200, 207), f"POST failed: {r.status_code} {r.text[:200]}"
    body = r.json()
    run_id = body.get("run_id")
    assert run_id is not None, f"Expected run_id, got {body}"

    # 2. GET the run by id — must return 200 (NOT 500) and carry started_at.
    r2 = requests.get(
        f"{BASE_URL}/v1/ingest/runs/{run_id}",
        headers=HEADERS,
        timeout=10,
    )
    assert r2.status_code == 200, (
        f"GET runs/{run_id} returned {r2.status_code} (regression: "
        f"column 'created_at' does not exist bug). Body: {r2.text[:300]}"
    )
    record = r2.json()
    assert record.get("id") == run_id, f"Expected id={run_id}, got {record}"
    assert "started_at" in record, (
        f"Expected started_at field, got {list(record.keys())}"
    )
    assert "created_at" not in record, (
        f"created_at must not be present (column doesn't exist); got {record}"
    )
    assert record.get("source") == "regression_buy43028"


@NEEDS_AUTH
@pytest.mark.ingest
def test_ingest_runs_list_returns_array_with_started_at():
    """Regression for BUY-43028: GET /v1/ingest/runs must
    return 200 with runs[] (started_at, not created_at)."""
    r = requests.get(
        f"{BASE_URL}/v1/ingest/runs",
        params={"limit": 5},
        headers=HEADERS,
        timeout=10,
    )
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text[:200]}"
    body = r.json()
    assert "runs" in body, f"Expected runs key, got {body}"
    if body["runs"]:
        first = body["runs"][0]
        assert "started_at" in first, f"Expected started_at, got {list(first.keys())}"
        assert "created_at" not in first, "created_at must not be present"


@NEEDS_AUTH
@pytest.mark.ingest
def test_ingest_runs_get_nonexistent_returns_404_not_500():
    """Regression for BUY-43028: a missing run_id must return 404,
    not 500 with a column-does-not-exist error."""
    r = requests.get(
        f"{BASE_URL}/v1/ingest/runs/99999999",
        headers=HEADERS,
        timeout=10,
    )
    assert r.status_code == 404, (
        f"Expected 404 for missing run, got {r.status_code}: {r.text[:200]}"
    )


@NEEDS_AUTH
@pytest.mark.ingest
def test_ingest_validation_error_returns_400_not_500():
    """BUY-43028 fix #3: validation failures must return 4xx,
    never 5xx. Catches the class of bugs where an unhandled
    error path returns 500 with `unhandled_error`."""
    # Missing required fields
    r = requests.post(
        f"{BASE_URL}/v1/ingest/products",
        headers={**HEADERS, "Content-Type": "application/json"},
        json={"source": "regression_buy43028", "products": [{}]},
        timeout=10,
    )
    assert r.status_code in (400, 207), (
        f"Validation failure must return 4xx (not 5xx); got {r.status_code}: {r.text[:300]}"
    )
    assert r.status_code < 500, "5xx on validation is a regression"

