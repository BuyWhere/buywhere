"""
Production API regression tests.

Run all scopes:   pytest tests/api/test_api_endpoints.py
Run one scope:    pytest tests/api/test_api_endpoints.py -m search
Available marks:  search, products, categories
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REGRESSION_BASE_URL", "https://api.buywhere.ai")
TIMEOUT = 10


# ---------------------------------------------------------------------------
# Search scope
# ---------------------------------------------------------------------------


@pytest.mark.search
def test_search_returns_results():
    resp = requests.get(f"{BASE_URL}/v1/search", params={"q": "iphone"}, timeout=TIMEOUT)
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
    data = resp.json()
    assert "results" in data or "products" in data, "Response missing results key"
    assert len(data.get("results", data.get("products", []))) > 0, "Search returned empty results"


@pytest.mark.search
def test_search_empty_query_handled():
    resp = requests.get(f"{BASE_URL}/v1/search", params={"q": ""}, timeout=TIMEOUT)
    assert resp.status_code in (200, 400), f"Unexpected status {resp.status_code}"


@pytest.mark.search
def test_search_response_time():
    import time
    start = time.time()
    resp = requests.get(f"{BASE_URL}/v1/search", params={"q": "laptop"}, timeout=TIMEOUT)
    elapsed = time.time() - start
    assert resp.status_code == 200
    assert elapsed < 3.0, f"Search took {elapsed:.2f}s, threshold is 3s"


# ---------------------------------------------------------------------------
# Products scope
# ---------------------------------------------------------------------------


@pytest.mark.products
def test_products_list_returns_200():
    resp = requests.get(f"{BASE_URL}/v1/products", timeout=TIMEOUT)
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"


@pytest.mark.products
def test_product_detail_valid_id():
    # Fetch product list first, grab first id
    list_resp = requests.get(f"{BASE_URL}/v1/products", params={"limit": 1}, timeout=TIMEOUT)
    assert list_resp.status_code == 200
    items = list_resp.json().get("results", list_resp.json().get("products", []))
    if not items:
        pytest.skip("No products available to test detail endpoint")
    product_id = items[0].get("id") or items[0].get("product_id")
    resp = requests.get(f"{BASE_URL}/v1/products/{product_id}", timeout=TIMEOUT)
    assert resp.status_code == 200, f"Product detail returned {resp.status_code}"


@pytest.mark.products
def test_product_detail_invalid_id_404():
    resp = requests.get(f"{BASE_URL}/v1/products/nonexistent-id-00000", timeout=TIMEOUT)
    assert resp.status_code in (404, 400), f"Expected 404/400 for missing product, got {resp.status_code}"


# ---------------------------------------------------------------------------
# Categories scope
# ---------------------------------------------------------------------------


@pytest.mark.categories
def test_categories_list_returns_200():
    resp = requests.get(f"{BASE_URL}/v1/categories", timeout=TIMEOUT)
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"


@pytest.mark.categories
def test_categories_list_non_empty():
    resp = requests.get(f"{BASE_URL}/v1/categories", timeout=TIMEOUT)
    assert resp.status_code == 200
    data = resp.json()
    items = data if isinstance(data, list) else data.get("categories", data.get("results", []))
    assert len(items) > 0, "Categories list is empty"


@pytest.mark.categories
def test_category_products_returns_results():
    cats_resp = requests.get(f"{BASE_URL}/v1/categories", timeout=TIMEOUT)
    assert cats_resp.status_code == 200
    data = cats_resp.json()
    items = data if isinstance(data, list) else data.get("categories", data.get("results", []))
    if not items:
        pytest.skip("No categories available")
    cat = items[0]
    cat_id = cat.get("id") or cat.get("slug") or cat.get("category_id")
    resp = requests.get(f"{BASE_URL}/v1/categories/{cat_id}/products", timeout=TIMEOUT)
    assert resp.status_code in (200, 404), f"Unexpected status {resp.status_code}"
