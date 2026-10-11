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


@pytest.mark.products
def test_products_list_merchant_id_filter_returns_only_that_merchant():
    """BUY-86406 regression: merchant_id=X must return only X's products."""
    # Use prettyballerinas.com as a known merchant with products in the catalog
    resp = requests.get(
        f"{BASE_URL}/v1/products",
        params={"merchant_id": "prettyballerinas.com", "limit": 5},
        timeout=TIMEOUT,
    )
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
    data = resp.json()
    items = data.get("data", data.get("results", []))
    for item in items:
        assert item.get("merchant_id") == "prettyballerinas.com", (
            f"Filter returned wrong merchant: {item.get('merchant_id')}"
        )


@pytest.mark.products
def test_products_list_merchant_id_nonexistent_returns_empty():
    """BUY-86406 regression: merchant_id=nonexistent returns empty page."""
    resp = requests.get(
        f"{BASE_URL}/v1/products",
        params={"merchant_id": "nonexistent_xyz_zzz_com_buy86406test", "limit": 5},
        timeout=TIMEOUT,
    )
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
    data = resp.json()
    items = data.get("data", data.get("results", []))
    assert len(items) == 0, f"Expected 0 items for nonexistent merchant, got {len(items)}"


@pytest.mark.products
def test_products_list_merchant_alias_filter():
    """BUY-86406 regression: 'merchant' and 'merchant_domain' are aliases for merchant_id."""
    for param in ("merchant", "merchant_domain"):
        resp = requests.get(
            f"{BASE_URL}/v1/products",
            params={param: "prettyballerinas.com", "limit": 3},
            timeout=TIMEOUT,
        )
        assert resp.status_code == 200
        data = resp.json()
        items = data.get("data", data.get("results", []))
        for item in items:
            assert item.get("merchant_id") == "prettyballerinas.com", (
                f"'{param}' alias returned wrong merchant: {item.get('merchant_id')}"
            )


@pytest.mark.products
def test_products_list_different_merchants_return_different_results():
    """BUY-86406 regression: ?merchant_id=A and ?merchant_id=B return different result sets."""
    resp_a = requests.get(
        f"{BASE_URL}/v1/products",
        params={"merchant_id": "prettyballerinas.com", "limit": 3},
        timeout=TIMEOUT,
    )
    resp_b = requests.get(
        f"{BASE_URL}/v1/products",
        params={"merchant_id": "sunbear.com", "limit": 3},
        timeout=TIMEOUT,
    )
    assert resp_a.status_code == 200
    assert resp_b.status_code == 200
    items_a = resp_a.json().get("data", resp_a.json().get("results", []))
    items_b = resp_b.json().get("data", resp_b.json().get("results", []))
    # If both have results, merchants must differ
    if items_a and items_b:
        assert items_a[0].get("merchant_id") != items_b[0].get("merchant_id"), (
            "Different merchant_id params returned identical first result"
        )


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
