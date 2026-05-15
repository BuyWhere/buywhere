"""LlamaIndex tool integration for BuyWhere.

Usage::

    from buywhere import BuyWhereClient
    from buywhere_llamaindex import create_buywhere_tools

    client = BuyWhereClient(api_key="bw_...")
    tools = create_buywhere_tools(client)

    # Use with LlamaIndex agent
    from llama_index.core.agent import FunctionCallingAgent
    agent = FunctionCallingAgent.from_tools(tools, llm=llm)
"""
from __future__ import annotations

import json
from typing import TYPE_CHECKING, List, Optional

from llama_index.core.tools import FunctionTool

if TYPE_CHECKING:
    from buywhere.client import BuyWhereClient


def search_products(
    client: "BuyWhereClient",
    query: str,
    country: str = "sg",
    category: Optional[str] = None,
    min_price: Optional[float] = None,
    max_price: Optional[float] = None,
    limit: int = 10,
) -> str:
    """Search the BuyWhere product catalog for products matching a query.

    Args:
        client: BuyWhere client instance (injected automatically).
        query: Product search query in natural language (e.g., "mechanical keyboard").
        country: Country code (default: sg).
        category: Category slug filter (e.g., "electronics").
        min_price: Minimum price in local currency.
        max_price: Maximum price in local currency.
        limit: Number of results to return (1-50).

    Returns:
        JSON string with product listings including prices, merchant info, and availability.
    """
    try:
        resp = client.products.search(
            q=query,
            country=country,
            category=category,
            min_price=min_price,
            max_price=max_price,
            limit=min(limit, 50),
        )

        products = []
        for r in resp.results:
            item = {
                "product_id": r.product_id,
                "title": r.title,
                "price": {
                    "amount": r.price.amount,
                    "currency": r.price.currency,
                },
                "merchant": {
                    "name": r.merchant.name,
                    "platform": r.merchant.platform,
                },
                "in_stock": r.availability.in_stock,
                "url": r.source_url,
            }
            if r.price.original_amount:
                item["original_price"] = r.price.original_amount
                item["discount_pct"] = r.price.discount_pct
            if r.relevance_score:
                item["relevance_score"] = r.relevance_score
            products.append(item)

        return json.dumps({
            "success": True,
            "total_estimated": resp.total_estimated,
            "returned": len(resp.results),
            "has_more": resp.has_more,
            "products": products,
        })
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})


def compare_prices(
    client: "BuyWhereClient",
    product_id: str,
) -> str:
    """Compare prices for a product across multiple merchants.

    Args:
        client: BuyWhere client instance (injected automatically).
        product_id: The BuyWhere product identifier.

    Returns:
        JSON string with sorted price listings from cheapest to most expensive.
    """
    try:
        resp = client.products.compare_prices(product_id)

        listings = []
        for l in resp.listings:
            listings.append({
                "listing_id": l.listing_id,
                "merchant": {
                    "name": l.merchant.name,
                    "platform": l.merchant.platform,
                    "rating": l.merchant.rating,
                },
                "price": {
                    "amount": l.price.amount,
                    "currency": l.price.currency,
                    "total": l.price.total,
                    "shipping_fee": l.price.shipping_fee,
                },
                "in_stock": l.availability.in_stock,
                "next_day_available": l.availability.next_day_available,
                "url": l.source_url,
            })

        result = {
            "success": True,
            "product_id": resp.product_id,
            "canonical_title": resp.canonical_title,
            "listings": listings,
        }
        if resp.best_price:
            result["best_price"] = {
                "listing_id": resp.best_price.listing_id,
                "total": resp.best_price.total,
                "currency": resp.best_price.currency,
            }
        if resp.best_value:
            result["best_value"] = {
                "listing_id": resp.best_value.listing_id,
                "total": resp.best_value.total,
                "currency": resp.best_value.currency,
                "rationale": resp.best_value.rationale,
            }

        return json.dumps(result)
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})


def get_deals(
    client: "BuyWhereClient",
    query: str,
    country: str = "sg",
    limit: int = 10,
) -> str:
    """Find current deals and price drops using a natural language query.

    Args:
        client: BuyWhere client instance (injected automatically).
        query: Natural language query for deals (e.g., "electronics on sale").
        country: Country code (default: sg).
        limit: Number of results to return (1-50).

    Returns:
        JSON string with products that have discounts and price drops.
    """
    try:
        resp = client.products.query(
            query=f"deals {query}",
            context={"country": country},
            limit=min(limit, 50),
        )

        deals = []
        for p in resp.products:
            deal = {
                "product_id": p.product_id,
                "title": p.title,
                "price": {
                    "amount": p.price.amount,
                    "currency": p.price.currency,
                },
                "merchant": {
                    "name": p.merchant.name,
                    "platform": p.merchant.platform,
                },
                "in_stock": p.availability.in_stock,
                "url": p.source_url,
            }
            if p.price.original_amount and p.price.original_amount > p.price.amount:
                deal["original_price"] = p.price.original_amount
                deal["discount_pct"] = round(
                    (1 - p.price.amount / p.price.original_amount) * 100, 1
                )
            deals.append(deal)

        return json.dumps({
            "success": True,
            "total": resp.total,
            "deals": deals,
        })
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})


def get_product_details(
    client: "BuyWhereClient",
    product_id: str,
) -> str:
    """Get detailed information about a specific product by its ID.

    Args:
        client: BuyWhere client instance (injected automatically).
        product_id: The BuyWhere product identifier.

    Returns:
        JSON string with full product details including all merchant prices,
        brand, description, and reviews.
    """
    try:
        product = client.products.get(product_id)

        result = {
            "success": True,
            "product": {
                "product_id": product.product_id,
                "title": product.title,
                "description": product.description_full,
                "category": product.category,
                "tags": product.tags,
                "price": {
                    "amount": product.price.amount,
                    "currency": product.price.currency,
                },
                "merchant": {
                    "name": product.merchant.name,
                    "platform": product.merchant.platform,
                    "rating": product.merchant.rating,
                    "review_count": product.merchant.review_count,
                },
                "availability": {
                    "in_stock": product.availability.in_stock,
                    "stock_level": product.availability.stock_level,
                },
                "images": [{"url": img.url, "role": img.role} for img in product.images],
                "url": product.source_url,
            },
        }

        if product.reviews_summary:
            result["product"]["reviews"] = {
                "average_rating": product.reviews_summary.average_rating,
                "total_reviews": product.reviews_summary.total_reviews,
                "sentiment": product.reviews_summary.sentiment,
            }

        if product.specifications:
            result["product"]["specifications"] = product.specifications

        return json.dumps(result)
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})


class BuyWhereToolSpec:
    """LlamaIndex tool specification for BuyWhere.

    Create tools from a BuyWhere client and pass them to any LlamaIndex agent.

    Example::

        from buywhere import BuyWhereClient
        from buywhere_llamaindex import BuyWhereToolSpec

        client = BuyWhereClient(api_key="bw_...")
        spec = BuyWhereToolSpec(client)
        tools = spec.to_tool_list()

        # Use with LlamaIndex agent
        from llama_index.core.agent import FunctionCallingAgent
        agent = FunctionCallingAgent.from_tools(tools, llm=llm)
    """

    def __init__(self, client: "BuyWhereClient") -> None:
        self._client = client

    def _search(self, query: str, country: str = "sg", category: Optional[str] = None,
                min_price: Optional[float] = None, max_price: Optional[float] = None,
                limit: int = 10) -> str:
        return search_products(self._client, query, country, category, min_price, max_price, limit)

    def _compare(self, product_id: str) -> str:
        return compare_prices(self._client, product_id)

    def _deals(self, query: str, country: str = "sg", limit: int = 10) -> str:
        return get_deals(self._client, query, country, limit)

    def _details(self, product_id: str) -> str:
        return get_product_details(self._client, product_id)

    def to_tool_list(self) -> List[FunctionTool]:
        """Return all BuyWhere tools as LlamaIndex FunctionTool instances."""
        return [
            FunctionTool.from_defaults(
                fn=self._search,
                name="buywhere_search_products",
                description=(
                    "Search BuyWhere's product catalog for products matching a query. "
                    "Returns product listings with prices, merchant info, availability, and buy links."
                ),
            ),
            FunctionTool.from_defaults(
                fn=self._compare,
                name="buywhere_compare_prices",
                description=(
                    "Compare prices for a specific product across all merchants. "
                    "Returns sorted listings from cheapest to most expensive with delivery info."
                ),
            ),
            FunctionTool.from_defaults(
                fn=self._deals,
                name="buywhere_get_deals",
                description=(
                    "Find current deals and price drops from BuyWhere. "
                    "Returns products with discounts, original prices, and savings percentages."
                ),
            ),
            FunctionTool.from_defaults(
                fn=self._details,
                name="buywhere_get_product_details",
                description=(
                    "Get detailed information about a specific product by its ID. "
                    "Returns full details including all merchant prices, brand, description, and reviews."
                ),
            ),
        ]


def create_buywhere_tools(client: "BuyWhereClient") -> List[FunctionTool]:
    """Create a list of LlamaIndex tools for the BuyWhere API.

    Args:
        client: An authenticated BuyWhere client.

    Returns:
        List of LlamaIndex FunctionTool instances.

    Example::

        from buywhere import BuyWhereClient
        from buywhere_llamaindex import create_buywhere_tools

        client = BuyWhereClient(api_key="bw_...")
        tools = create_buywhere_tools(client)
    """
    spec = BuyWhereToolSpec(client)
    return spec.to_tool_list()
