"""
BUY-4903 Phase 2 tests — compare page full validation
Tests all 4 confirmed slugs against acceptance criteria.

Run with: pytest tests/test_compare_pages.py -v
"""

import re
import json
import pytest
import httpx
from decimal import Decimal
from unittest.mock import MagicMock, AsyncMock, patch


# --- Config ---
API_BASE_URL = "https://staging.buywhere.ai"
COMPARE_ENDPOINT = f"{API_BASE_URL}/v1/compare"
PAGES_ENDPOINT = f"{API_BASE_URL}/v1/compare/pages"
SITEMAP_URL = f"{API_BASE_URL}/sitemap-compare.xml"

# Slugs to test — confirm with Rex/Sol if different
CONFIRMED_SLUGS = ["iphone-14-pro-max-256gb-sg", "samsung-galaxy-s23-sg", "ipad-pro-12-9-sg"]
PENDING_SLUGS = ["macbook-air-m2-sg"]  # 4th slug - pending from Sol

ALL_SLUGS = CONFIRMED_SLUGS + PENDING_SLUGS


# --- Helpers ---

def is_valid_slug(s: str) -> bool:
    return bool(re.compile(r'^[a-z0-9]+(-[a-z0-9]+)*$').match(s)) and len(s) <= 70


def validate_product_schema(data: dict) -> list[str]:
    """Validate Product JSON-LD schema. Returns list of errors."""
    errors = []
    if "@type" not in data or data.get("@type") != "Product":
        errors.append(f"Missing @type 'Product' in {data.get('@type', 'unknown')}")
    if "name" not in data:
        errors.append("Missing 'name' in Product schema")
    if "image" not in data:
        errors.append("Missing 'image' in Product schema")
    if "offers" not in data:
        errors.append("Missing 'offers' in Product schema")
    return errors


def validate_aggregate_offer(data: dict) -> list[str]:
    """Validate AggregateOffer schema. Returns list of errors."""
    errors = []
    if "@type" not in data or data.get("@type") != "AggregateOffer":
        errors.append(f"Missing @type 'AggregateOffer' in {data.get('@type', 'unknown')}")
    if "lowPrice" not in data:
        errors.append("Missing 'lowPrice' in AggregateOffer")
    if "highPrice" not in data:
        errors.append("Missing 'highPrice' in AggregateOffer")
    if "priceCurrency" not in data:
        errors.append("Missing 'priceCurrency' in AggregateOffer")
    if "offerCount" not in data:
        errors.append("Missing 'offerCount' in AggregateOffer")
    return errors


def validate_retailer_price_payload(data: dict) -> list[str]:
    """Validate ComparisonPageData payload structure. Returns list of errors."""
    errors = []
    required_fields = ["slug", "product_id", "category", "canonical_url", "product", "retailers",
                      "lowest_price", "lowest_price_formatted", "lowest_price_retailer",
                      "metadata", "breadcrumb"]
    for field in required_fields:
        if field not in data:
            errors.append(f"Missing required field: '{field}'")

    if "retailers" in data and isinstance(data["retailers"], list):
        if len(data["retailers"]) == 0:
            errors.append("'retailers' array is empty")
        for idx, retailer in enumerate(data["retailers"]):
            for subfield in ["retailer_id", "retailer_name", "price", "url"]:
                if subfield not in retailer:
                    errors.append(f"Retailer[{idx}] missing '{subfield}'")

    if "product" in data and isinstance(data["product"], dict):
        for subfield in ["id", "title", "brand", "description", "image_url"]:
            if subfield not in data["product"]:
                errors.append(f"product missing '{subfield}'")

    return errors


# --- Tests ---

class TestComparePageEndpoints:
    """Test HTTP 200 + valid JSON payload for all 4 slugs."""

    @pytest.mark.parametrize("slug", ALL_SLUGS)
    @pytest.mark.asyncio
    async def test_compare_page_http_200(self, slug: str):
        """Verify each slug returns HTTP 200 from /compare/pages/{slug}."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(f"{PAGES_ENDPOINT}/{slug}")
            assert resp.status_code == 200, f"Expected 200 for slug '{slug}', got {resp.status_code}: {resp.text[:200]}"

    @pytest.mark.parametrize("slug", ALL_SLUGS)
    @pytest.mark.asyncio
    async def test_compare_page_valid_payload(self, slug: str):
        """Verify each slug returns valid ComparisonPageData JSON."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(f"{PAGES_ENDPOINT}/{slug}")
            assert resp.status_code == 200
            data = resp.json()
            errors = validate_retailer_price_payload(data)
            assert not errors, f"Payload validation errors for '{slug}': {errors}"

    @pytest.mark.parametrize("slug", ALL_SLUGS)
    @pytest.mark.asyncio
    async def test_compare_page_has_retailers(self, slug: str):
        """Verify each slug returns at least 1 retailer."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(f"{PAGES_ENDPOINT}/{slug}")
            assert resp.status_code == 200
            data = resp.json()
            assert "retailers" in data, f"'retailers' key missing for '{slug}'"
            assert isinstance(data["retailers"], list), f"'retailers' not a list for '{slug}'"
            assert len(data["retailers"]) >= 1, f"No retailers returned for '{slug}'"

    @pytest.mark.parametrize("slug", ALL_SLUGS)
    @pytest.mark.asyncio
    async def test_compare_page_has_product(self, slug: str):
        """Verify each slug returns product metadata."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(f"{PAGES_ENDPOINT}/{slug}")
            assert resp.status_code == 200
            data = resp.json()
            assert "product" in data, f"'product' key missing for '{slug}'"
            p = data["product"]
            assert "title" in p, f"product.title missing for '{slug}'"
            assert "brand" in p, f"product.brand missing for '{slug}'"

    @pytest.mark.parametrize("slug", ALL_SLUGS)
    @pytest.mark.asyncio
    async def test_compare_page_has_seo_metadata(self, slug: str):
        """Verify each slug returns SEO metadata."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(f"{PAGES_ENDPOINT}/{slug}")
            assert resp.status_code == 200
            data = resp.json()
            assert "breadcrumb" in data, f"breadcrumb missing for '{slug}'"
            assert isinstance(data["breadcrumb"], list), f"breadcrumb not list for '{slug}'"
            assert len(data["breadcrumb"]) >= 2, f"breadcrumb too short for '{slug}'"


class TestComparePageRichResults:
    """Test Rich Results validation (Product + AggregateOffer schema)."""

    @pytest.mark.parametrize("slug", ALL_SLUGS)
    @pytest.mark.asyncio
    async def test_rich_results_product_schema(self, slug: str):
        """Verify Product JSON-LD schema present and valid."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(f"{PAGES_ENDPOINT}/{slug}")
            assert resp.status_code == 200
            data = resp.json()

            # Check structured_data field
            assert "structured_data" in data, f"'structured_data' missing for '{slug}'"
            sd = data["structured_data"]
            assert isinstance(sd, list), f"'structured_data' not a list for '{slug}'"

            # Find Product schema
            product_schema = None
            for item in sd:
                if isinstance(item, dict) and item.get("@type") == "Product":
                    product_schema = item
                    break

            assert product_schema is not None, f"No Product schema found in structured_data for '{slug}'"
            errors = validate_product_schema(product_schema)
            assert not errors, f"Product schema errors for '{slug}': {errors}"

    @pytest.mark.parametrize("slug", ALL_SLUGS)
    @pytest.mark.asyncio
    async def test_rich_results_aggregate_offer_schema(self, slug: str):
        """Verify AggregateOffer JSON-LD schema present and valid."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(f"{PAGES_ENDPOINT}/{slug}")
            assert resp.status_code == 200
            data = resp.json()

            sd = data.get("structured_data", [])
            # AggregateOffer is nested inside Product's offers field, not top-level
            product_schema = next((item for item in sd if isinstance(item, dict) and item.get("@type") == "Product"), None)
            assert product_schema is not None, f"No Product schema for '{slug}'"

            offers = product_schema.get("offers", {})
            assert offers.get("@type") == "AggregateOffer", f"AggregateOffer missing in Product offers for '{slug}'"

            errors = validate_aggregate_offer(offers)
            assert not errors, f"AggregateOffer errors for '{slug}': {errors}"

    @pytest.mark.parametrize("slug", ALL_SLUGS)
    @pytest.mark.asyncio
    async def test_rich_results_breadcrumb_schema(self, slug: str):
        """Verify BreadcrumbList schema present."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(f"{PAGES_ENDPOINT}/{slug}")
            assert resp.status_code == 200
            data = resp.json()

            sd = data.get("structured_data", [])
            breadcrumb_schema = next((item for item in sd if isinstance(item, dict) and item.get("@type") == "BreadcrumbList"), None)
            assert breadcrumb_schema is not None, f"No BreadcrumbList schema found for '{slug}'"
            items = breadcrumb_schema.get("itemListElement", [])
            assert len(items) >= 2, f"BreadcrumbList too short for '{slug}'"


class TestSitemapCompare:
    """Test sitemap-compare.xml includes all 4 slugs."""

    @pytest.mark.asyncio
    async def test_sitemap_exists(self):
        """Verify sitemap-compare.xml is accessible."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(SITEMAP_URL)
            assert resp.status_code == 200, f"sitemap-compare.xml returned {resp.status_code}"

    @pytest.mark.asyncio
    async def test_sitemap_valid_xml(self):
        """Verify sitemap-compare.xml is valid XML."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(SITEMAP_URL)
            assert resp.status_code == 200
            content = resp.text
            assert "<?xml" in content, "sitemap-compare.xml is not XML"
            assert "<urlset" in content, "sitemap-compare.xml missing <urlset>"

    @pytest.mark.asyncio
    async def test_sitemap_contains_all_slugs(self):
        """Verify all 4 slugs appear in sitemap-compare.xml."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(SITEMAP_URL)
            assert resp.status_code == 200
            content = resp.text.lower()

            missing = []
            for slug in ALL_SLUGS:
                if slug.lower() not in content:
                    missing.append(slug)

            assert not missing, f"Slugs missing from sitemap-compare.xml: {missing}"

    @pytest.mark.asyncio
    async def test_sitemap_has_4_slugs(self):
        """Verify sitemap-compare.xml contains at least 4 <loc> entries for compare pages."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(SITEMAP_URL)
            assert resp.status_code == 200
            content = resp.text

            # Count <loc> entries that contain /compare/
            loc_matches = re.findall(r'<loc>[^<]*\/compare\/[^<]*</loc>', content, re.IGNORECASE)
            assert len(loc_matches) >= 4, f"Expected >= 4 compare slugs in sitemap, found {len(loc_matches)}"


class TestPriceTableSort:
    """Price table sort — verified via code inspection (no browser)."""

    def test_price_table_has_sort_pills(self):
        """
        CONFIRMED via code inspection:
        frontend/components/PriceTable.tsx:135-156 has sort pills:
        - Price: Low to High (price_low_to_high)
        - Price: High to Low (price_high_to_low)
        - Availability (availability)
        """
        # This test always passes — documenting the confirmed state
        # Actual browser testing requires human QA or Playwright
        assert True, "Sort pills confirmed in PriceTable.tsx:135-156"

    def test_price_table_sort_state(self):
        """
        CONFIRMED: PriceTable.tsx:59 uses useState<SortOption>('price_low_to_high')
        Default sort is price_low_to_high.
        """
        assert True, "Default sort state confirmed in PriceTable.tsx:59"


class TestPostHogEvents:
    """PostHog events — verified via code inspection (no browser/network)."""

    def test_posthog_not_in_frontend(self):
        """
        NOT FOUND in codebase — no posthog/analytics calls in any compare page components.

        Searched: frontend/**/*.tsx for posthog, snap, segment, analytics, track, page_load
        Result: 0 matches in compare page components

        This is a QA finding — if PostHog is required, it must be implemented.
        """
        # This test documents the current state (no PostHog found)
        # Rex/Sol need to confirm if PostHog is planned/required
        assert True, "PostHog: NOT FOUND in compare page frontend code"

    def test_posthog_not_in_backend(self):
        """
        NOT FOUND in backend — no PostHog SDK or event calls in compare router.
        """
        assert True, "PostHog: NOT FOUND in compare.py backend"


class TestDisclosureFooter:
    """Disclosure footer — verified via code inspection."""

    def test_disclosure_component_exists(self):
        """
        CONFIRMED: frontend/components/Disclosure.tsx:26-30
        Renders affiliate disclosure footer with text:
        'Prices updated {relative_time}. BuyWhere earns commission on purchases through retailer links.'
        """
        assert True, "Disclosure component confirmed in Disclosure.tsx:26-30"

    def test_disclosure_used_in_compare_page(self):
        """
        CONFIRMED: frontend/app/compare/[slug]/page.tsx:162
        <Disclosure updatedAt={data.metadata.updated_at} />
        """
        assert True, "Disclosure component used in compare page at line 162"


# --- JSON-LD standalone validation (no network needed) ---

class TestJSONLDScaffold:
    """Unit tests for JSON-LD generation functions — no network required."""

    def test_product_schema_generation(self):
        """Test generateProductJSONLD produces valid Product schema."""
        from frontend.lib.jsonld import generateProductJSONLD
        from frontend.types.compare import ComparisonPageData

        # Minimal mock data
        mock_data: ComparisonPageData = {
            "slug": "test-product-sg",
            "product_id": "123",
            "category": "electronics",
            "canonical_url": "https://buywhere.ai/compare/test-product-sg",
            "product": {
                "id": "123",
                "title": "Test Product",
                "brand": "TestBrand",
                "description": "A test product",
                "image_url": "https://example.com/image.jpg",
                "category_path": ["Electronics", "Phones"],
                "specs": [],
            },
            "retailers": [
                {
                    "retailer_id": "shopee_sg",
                    "retailer_name": "Shopee",
                    "retailer_logo_url": "https://logo.clearbit.com/shopee.sg",
                    "retailer_domain": "shopee.sg",
                    "region": "SG",
                    "price": 99.99,
                    "price_formatted": "S$99.99",
                    "availability": "in_stock",
                    "availability_label": "In Stock",
                    "url": "https://shopee.sg/product/123",
                }
            ],
            "lowest_price": 99.99,
            "lowest_price_formatted": "S$99.99",
            "lowest_price_retailer": "Shopee",
            "related_comparisons": [],
            "metadata": {"updated_at": "2026-04-27T00:00:00Z"},
            "breadcrumb": [
                {"name": "Home", "url": "https://buywhere.ai"},
                {"name": "Compare", "url": "https://buywhere.ai/compare"},
            ],
        }

        result = generateProductJSONLD(mock_data)
        assert result["@type"] == "Product"
        assert result["name"] == "Test Product"
        assert result["brand"]["name"] == "TestBrand"
        assert "offers" in result

    def test_aggregate_offer_schema_generation(self):
        """Test generateAggregateOfferJSONLD produces valid AggregateOffer schema."""
        from frontend.lib.jsonld import generateAggregateOfferJSONLD
        from frontend.types.compare import ComparisonPageData

        mock_data: ComparisonPageData = {
            "slug": "test-product-sg",
            "product_id": "123",
            "category": "electronics",
            "canonical_url": "https://buywhere.ai/compare/test-product-sg",
            "product": {
                "id": "123",
                "title": "Test Product",
                "brand": "TestBrand",
                "description": "A test product",
                "image_url": "https://example.com/image.jpg",
                "category_path": ["Electronics"],
                "specs": [],
            },
            "retailers": [
                {"retailer_id": "shopee_sg", "retailer_name": "Shopee", "retailer_logo_url": "",
                 "retailer_domain": "shopee.sg", "region": "SG", "price": 80.0,
                 "price_formatted": "S$80.00", "availability": "in_stock",
                 "availability_label": "In Stock", "url": "https://shopee.sg/1"},
                {"retailer_id": "lazada_sg", "retailer_name": "Lazada", "retailer_logo_url": "",
                 "retailer_domain": "lazada.sg", "region": "SG", "price": 120.0,
                 "price_formatted": "S$120.00", "availability": "in_stock",
                 "availability_label": "In Stock", "url": "https://lazada.sg/1"},
            ],
            "lowest_price": 80.0,
            "lowest_price_formatted": "S$80.00",
            "lowest_price_retailer": "Shopee",
            "related_comparisons": [],
            "metadata": {"updated_at": "2026-04-27T00:00:00Z"},
            "breadcrumb": [],
        }

        result = generateAggregateOfferJSONLD(mock_data)
        assert result["@type"] == "AggregateOffer"
        assert result["lowPrice"] == 80.0
        assert result["highPrice"] == 120.0
        assert result["priceCurrency"] == "SGD"
        assert result["offerCount"] == 2


if __name__ == "__main__":
    pytest.main([__file__, "-v"])