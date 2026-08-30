"""Tests for buywhere-llamaindex tools."""
from __future__ import annotations

import json
from typing import Optional
from unittest.mock import MagicMock

import pytest

from buywhere.models import (
    AvailabilityInfo,
    MerchantInfo,
    PriceInfo,
    Product,
    SearchResponse,
    SearchResult,
    PriceCompareResponse,
    Listing,
    ListingPrice,
    ListingAvailability,
    BestOption,
    NLQueryResponse,
    InterpretedAs,
)
from buywhere_llamaindex import create_buywhere_tools, BuyWhereToolSpec


def _make_client() -> MagicMock:
    client = MagicMock()
    return client


def _sample_search_result(title: str = "Test Product", amount: float = 99.99) -> SearchResult:
    return SearchResult(
        product_id="prod_123",
        title=title,
        category="electronics",
        price=PriceInfo(amount=amount, currency="SGD"),
        merchant=MerchantInfo(merchant_id="m1", name="Shopee SG", platform="shopee"),
        availability=AvailabilityInfo(in_stock=True),
        source_url="https://shopee.sg/product/123",
        last_synced_at="2026-05-01T00:00:00Z",
        relevance_score=0.95,
    )


def _sample_search_response() -> SearchResponse:
    return SearchResponse(
        total_estimated=2,
        has_more=False,
        results=[
            _sample_search_result("Wireless Headphones", 79.90),
            _sample_search_result("Bluetooth Speaker", 49.90),
        ],
    )


def _sample_product() -> Product:
    return Product(
        product_id="prod_456",
        title="iPhone 15 Pro 256GB",
        description_full="Latest iPhone with A17 Pro chip",
        category="electronics/smartphones",
        tags=["apple", "iphone", "smartphone"],
        price=PriceInfo(amount=1699.00, currency="SGD"),
        merchant=MerchantInfo(
            merchant_id="m2", name="Lazada SG", platform="lazada", rating=4.8, review_count=234
        ),
        availability=AvailabilityInfo(in_stock=True, stock_level="high"),
        source_url="https://lazada.sg/iphone15pro",
        last_synced_at="2026-05-01T00:00:00Z",
    )


def _sample_price_compare() -> PriceCompareResponse:
    return PriceCompareResponse(
        product_id="prod_123",
        canonical_title="Wireless Headphones",
        listings=[
            Listing(
                listing_id="l1",
                merchant=MerchantInfo(merchant_id="m1", name="Shopee SG", platform="shopee", rating=4.5),
                price=ListingPrice(amount=79.90, currency="SGD", shipping_fee=0.0, total=79.90),
                availability=ListingAvailability(in_stock=True, next_day_available=True),
                source_url="https://shopee.sg/product/123",
                last_synced_at="2026-05-01T00:00:00Z",
            ),
            Listing(
                listing_id="l2",
                merchant=MerchantInfo(merchant_id="m2", name="Lazada SG", platform="lazada", rating=4.3),
                price=ListingPrice(amount=89.90, currency="SGD", shipping_fee=5.0, total=94.90),
                availability=ListingAvailability(in_stock=True),
                source_url="https://lazada.sg/product/123",
                last_synced_at="2026-05-01T00:00:00Z",
            ),
        ],
        best_price=BestOption(listing_id="l1", total=79.90, currency="SGD"),
        best_value=BestOption(listing_id="l1", total=79.90, currency="SGD", rationale="Lowest total price"),
    )


def _sample_nl_query() -> NLQueryResponse:
    return NLQueryResponse(
        original_query="deals electronics",
        interpreted_as=InterpretedAs(categories=["electronics"], sort="relevance"),
        products=[
            _sample_search_result("USB-C Cable", 12.90),
        ],
        total=1,
    )


class TestSearchProducts:
    def test_returns_json_with_products(self):
        client = _make_client()
        client.products.search.return_value = _sample_search_response()

        tools = create_buywhere_tools(client)
        search_tool = next(t for t in tools if t.metadata.name == "buywhere_search_products")

        result = search_tool.fn(query="headphones", country="sg")
        parsed = json.loads(result)

        assert parsed["success"] is True
        assert parsed["total_estimated"] == 2
        assert len(parsed["products"]) == 2
        assert parsed["products"][0]["title"] == "Wireless Headphones"
        assert parsed["products"][0]["price"]["amount"] == 79.90

    def test_handles_api_error(self):
        client = _make_client()
        client.products.search.side_effect = Exception("API error")

        tools = create_buywhere_tools(client)
        search_tool = next(t for t in tools if t.metadata.name == "buywhere_search_products")

        result = json.loads(search_tool.fn(query="test"))
        assert result["success"] is False
        assert "API error" in result["error"]


class TestComparePrices:
    def test_returns_sorted_listings(self):
        client = _make_client()
        client.products.compare_prices.return_value = _sample_price_compare()

        tools = create_buywhere_tools(client)
        compare_tool = next(t for t in tools if t.metadata.name == "buywhere_compare_prices")

        result = json.loads(compare_tool.fn(product_id="prod_123"))
        assert result["success"] is True
        assert len(result["listings"]) == 2
        assert result["best_price"]["total"] == 79.90
        assert result["canonical_title"] == "Wireless Headphones"


class TestGetDeals:
    def test_returns_deals_with_discounts(self):
        client = _make_client()
        client.products.query.return_value = _sample_nl_query()

        tools = create_buywhere_tools(client)
        deals_tool = next(t for t in tools if t.metadata.name == "buywhere_get_deals")

        result = json.loads(deals_tool.fn(query="electronics", country="sg"))
        assert result["success"] is True
        assert len(result["deals"]) == 1


class TestGetProductDetails:
    def test_returns_full_product_info(self):
        client = _make_client()
        client.products.get.return_value = _sample_product()

        tools = create_buywhere_tools(client)
        details_tool = next(t for t in tools if t.metadata.name == "buywhere_get_product_details")

        result = json.loads(details_tool.fn(product_id="prod_456"))
        assert result["success"] is True
        assert result["product"]["title"] == "iPhone 15 Pro 256GB"
        assert result["product"]["category"] == "electronics/smartphones"
        assert len(result["product"]["tags"]) == 3


class TestBuyWhereToolSpec:
    def test_to_tool_list_returns_four_tools(self):
        client = _make_client()
        spec = BuyWhereToolSpec(client)
        tools = spec.to_tool_list()
        assert len(tools) == 4

    def test_tool_names_are_correct(self):
        client = _make_client()
        tools = create_buywhere_tools(client)
        names = {t.metadata.name for t in tools}
        assert names == {
            "buywhere_search_products",
            "buywhere_compare_prices",
            "buywhere_get_deals",
            "buywhere_get_product_details",
        }

    def test_all_tools_have_descriptions(self):
        client = _make_client()
        tools = create_buywhere_tools(client)
        for tool in tools:
            assert len(tool.metadata.description) > 0


class TestCreateBuywhereTools:
    def test_returns_function_tool_instances(self):
        from llama_index.core.tools import FunctionTool

        client = _make_client()
        tools = create_buywhere_tools(client)
        for tool in tools:
            assert isinstance(tool, FunctionTool)
