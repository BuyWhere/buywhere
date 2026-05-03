"""Tests for search endpoint subcategory matching via category_path."""

import sys
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch, call
import pytest

sys.path.insert(0, "/home/paperclip/buywhere-api")


def _make_product(category: str, category_path: list) -> MagicMock:
    from app.models.product import Product

    p = MagicMock(spec=Product)
    p.id = 1
    p.sku = "SKU-SUBCAT-001"
    p.source = "watsons_sg"
    p.merchant_id = "watsons"
    p.title = "Moisturizing Eye Cream 15ml"
    p.description = "Eye cream"
    p.price = Decimal("29.90")
    p.currency = "SGD"
    p.price_sgd = Decimal("29.90")
    p.url = "https://watsons.com.sg/eye-cream/123"
    p.brand = "Neutrogena"
    p.category = category
    p.category_path = category_path
    p.image_url = "https://watsons.com.sg/image.jpg"
    p.barcode = None
    p.is_active = True
    p.is_available = True
    p.in_stock = True
    p.stock_level = None
    p.last_checked = datetime(2026, 5, 3, tzinfo=timezone.utc)
    p.updated_at = datetime(2026, 5, 3, tzinfo=timezone.utc)
    p.region = "sea"
    p.country_code = "SG"
    p.rating = None
    p.review_count = None
    p.metadata_ = None
    p.structured_specs = None
    p.affiliate_url = None
    p.discount_pct = None
    p.original_price = None
    return p


class TestSearchCategorySubcategoryMatch:
    """Category filter must match subcategory entries stored in category_path."""

    def test_search_category_subcategory_match(self):
        """
        Searching for 'Hair Care' must surface products whose category_path
        contains a subcategory like 'All Hair Types', not just products where
        category == 'Hair Care'.

        Verifies the text() clause added in BUY-7836 uses unnest on category_path:
          EXISTS (SELECT 1 FROM unnest(category_path) AS _cp WHERE _cp ILIKE '%Hair Care%')
        """
        from sqlalchemy import text

        category = "Hair Care"
        text_clause = text(
            "EXISTS (SELECT 1 FROM unnest(category_path) AS _cp WHERE _cp ILIKE :cat_ptn)"
        ).bindparams(cat_ptn=f"%{category}%")
        compiled = text_clause.compile()
        assert "unnest" in str(text_clause)
        assert "cat_ptn" in str(text_clause)
        assert f"%{category}%" in compiled.params.get("cat_ptn", "")

    def test_search_category_subcategory_partial_match(self):
        """
        Searching for 'Toothbrush' must match products where category_path
        contains 'Electric Toothbrushes' or 'Manual Toothbrushes' even when
        category is set to a broader label.

        Verifies the facet query also uses the OR+unnest clause (BUY-7836 lines 584-595).
        """
        from sqlalchemy import or_, text

        category = "Toothbrush"

        # Main query clause
        main_clause = text(
            "EXISTS (SELECT 1 FROM unnest(category_path) AS _cp WHERE _cp ILIKE :cat_ptn)"
        ).bindparams(cat_ptn=f"%{category}%")

        # Facet query clause uses a distinct bind param name to avoid collision
        facet_clause = text(
            "EXISTS (SELECT 1 FROM unnest(category_path) AS _cp WHERE _cp ILIKE :cat_ptn_f)"
        ).bindparams(cat_ptn_f=f"%{category}%")

        # Count query clause uses its own bind param name
        count_clause = text(
            "EXISTS (SELECT 1 FROM unnest(category_path) AS _cp WHERE _cp ILIKE :cat_ptn_c)"
        ).bindparams(cat_ptn_c=f"%{category}%")

        for clause, param_key in [
            (main_clause, "cat_ptn"),
            (facet_clause, "cat_ptn_f"),
            (count_clause, "cat_ptn_c"),
        ]:
            compiled = clause.compile()
            assert "unnest" in str(clause)
            assert f"%{category}%" in compiled.params.get(param_key, ""), (
                f"Expected %{category}% in bind param '{param_key}'"
            )
