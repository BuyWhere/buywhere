from decimal import Decimal
from types import SimpleNamespace

from app.schemas.product import CompareMatch, ProductMatchesResponse
from app.services.matches import (
    is_us_retailer_source,
    normalized_match_key,
    retailer_key,
    score_name_brand_match,
    title_search_tokens,
)


def test_us_retailer_source_detection():
    assert is_us_retailer_source("amazon_us")
    assert is_us_retailer_source("amazon.com")
    assert is_us_retailer_source("walmart_us_marketplace")
    assert is_us_retailer_source("target_us")
    assert not is_us_retailer_source("amazon_sg")
    assert retailer_key("amazon.com") == "amazon"
    assert retailer_key("amazon_us") == "amazon"
    assert retailer_key("walmart.com_marketplace") == "walmart"


def test_name_brand_match_score_accepts_same_item_across_retailers():
    source = SimpleNamespace(
        title="Sony WH-1000XM5 Wireless Noise Canceling Headphones",
        brand="Sony",
        price=Decimal("298.00"),
    )
    candidate = SimpleNamespace(
        title="Sony WH1000XM5 Wireless Noise-Canceling Headphones",
        brand="Sony",
        price=Decimal("299.00"),
    )

    assert "sony" in normalized_match_key(source.title, source.brand)
    assert title_search_tokens(source.title)[:2] == ["sony", "1000xm5"]
    assert score_name_brand_match(source, candidate) >= 0.84


def test_product_matches_response_uses_compare_matches():
    match = CompareMatch(
        id=2,
        sku="target-sony-wh1000xm5",
        source="target_us",
        merchant_id="target_us",
        name="Sony WH1000XM5 Wireless Noise-Canceling Headphones",
        description=None,
        price=Decimal("299.00"),
        currency="USD",
        buy_url="https://example.com/product",
        is_available=True,
        updated_at="2026-04-22T00:00:00Z",
        match_score=0.94,
    )

    response = ProductMatchesResponse(
        product_id=1,
        matches=[match],
        total_matches=1,
    )

    assert response.total_matches == 1
    assert response.matches[0].source == "target_us"
