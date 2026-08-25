"""BUY-74689: regression for merchant_name/merchant_slug emission in _map_product.

Asserts:
- _map_product surfaces the real merchant name (from merchants table), not the platform slug.
- merchant_slug is kebab-case (lowercase, dashes only).
- source / merchant_id are preserved (backwards-compatible with existing clients).
- Orphaned merchant_id (no row in merchants) yields None for both — never raises.
- _slugify_merchant edge cases: strip punctuation, collapse runs, drop empty result.
- _resolve_merchants deduplicates input IDs and short-circuits on empty input.

These run without a live DB (pure unit); integration coverage comes from the
api/test_api_endpoints.py live probes and BUY-74684 Atlas QA gate.
"""
import os
from datetime import datetime, timezone

import pytest

# Skip the entire module if the api package isn't importable (e.g. CI without deps)
pytest.importorskip("app", reason="api package not installed in this environment")


_FIXED_UPDATED_AT = datetime(2026, 1, 1, tzinfo=timezone.utc)


def test_slugify_basic():
    from app.routers.products import _slugify_merchant
    assert _slugify_merchant("Alltronic") == "alltronic"
    assert _slugify_merchant("Tech House") == "tech-house"
    assert _slugify_merchant("Popular Bookstore") == "popular-bookstore"
    assert _slugify_merchant("ABC & Co.") == "abc-co"
    assert _slugify_merchant("  Multiple   Spaces  ") == "multiple-spaces"


def test_slugify_empty_returns_empty():
    from app.routers.products import _slugify_merchant
    assert _slugify_merchant("") == ""
    assert _slugify_merchant("!!!") == ""
    assert _slugify_merchant("---") == ""


def test_slugify_already_lowercase_passthrough():
    from app.routers.products import _slugify_merchant
    assert _slugify_merchant("shopify") == "shopify"
    assert _slugify_merchant("shopee_sg").replace("_", "-") == _slugify_merchant("shopee_sg")  # underscores become dash


def test_map_product_emits_merchant_name_and_slug(monkeypatch):
    """_map_product should pass through merchant_name/merchant_slug when supplied."""
    from app.routers.products import _map_product
    from app.models.product import Product

    p = Product(
        id=1,
        sku="sku-1",
        source="shopify",
        merchant_id="m-alltronic",
        title="Sample",
        description=None,
        price=10.0,
        currency="SGD",
        url="https://example.com",
        image_url=None,
        brand=None,
        category=None,
        is_active=True,
        is_available=True,
        region="sg",
        country_code="SG",
        updated_at=None,
    )
    p.updated_at = _FIXED_UPDATED_AT
    resp = _map_product(
        p,
        merchant_name="Alltronic",
        merchant_slug="alltronic",
    )
    assert resp.merchant_name == "Alltronic"
    assert resp.merchant_slug == "alltronic"
    # source / merchant_id still preserved for filtering/analytics
    assert resp.source == "shopify"
    assert resp.merchant_id == "m-alltronic"


def test_map_product_defaults_none_when_unprovided():
    """_map_product without merchant_name/merchant_slug kwargs yields None (fallback rows)."""
    from app.routers.products import _map_product
    from app.models.product import Product

    p = Product(
        id=2,
        sku="sku-2",
        source="shopee_sg",
        merchant_id="m-orphan",
        title="Orphan",
        description=None,
        price=20.0,
        currency="SGD",
        url="https://example.com",
        image_url=None,
        brand=None,
        category=None,
        is_active=True,
        is_available=True,
        region="sg",
        country_code="SG",
        updated_at=None,
    )
    p.updated_at = _FIXED_UPDATED_AT
    resp = _map_product(p)
    assert resp.merchant_name is None
    assert resp.merchant_slug is None
    assert resp.source == "shopee_sg"
    assert resp.merchant_id == "m-orphan"


def test_resolve_merchants_short_circuits_on_empty():
    import asyncio
    from unittest.mock import AsyncMock
    from app.routers.products import _resolve_merchants

    db = AsyncMock()
    out = asyncio.run(_resolve_merchants(db, []))
    assert out == {}
    db.execute.assert_not_called()


def test_resolve_merchants_dedupes_and_handles_orphans():
    """Distinct IDs trigger one query; orphans (no matching merchant row) yield None."""
    import asyncio
    from unittest.mock import AsyncMock, MagicMock
    from app.routers.products import _resolve_merchants

    db = AsyncMock()
    # Simulate a result with two known merchants and one missing
    fake_rows = [
        ("m-alltronic", "Alltronic"),
        ("m-popular", "Popular Bookstore"),
        ("m-tech-house", "Tech House"),
    ]

    class FakeResult:
        def fetchall(self_inner):
            return fake_rows

    db.execute = AsyncMock(return_value=FakeResult())

    out = asyncio.run(_resolve_merchants(db, [
        "m-alltronic", "m-popular", "m-tech-house", "m-alltronic",  # duplicate
        "m-orphan",  # not in merchants table
        "",  # falsy
    ]))
    assert out["m-alltronic"] == ("Alltronic", "alltronic")
    assert out["m-popular"] == ("Popular Bookstore", "popular-bookstore")
    assert out["m-tech-house"] == ("Tech House", "tech-house")
    assert "m-orphan" not in out
    # Only one execute call despite 6 inputs
    assert db.execute.await_count == 1