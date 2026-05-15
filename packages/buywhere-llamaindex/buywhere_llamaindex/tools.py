"""LlamaIndex FunctionTool wrappers for the BuyWhere catalog API."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from llama_index.core.tools import FunctionTool
from pydantic import BaseModel, Field

from buywhere_llamaindex.client import BuyWhereClient


class ProductResult(BaseModel):
    id: str
    name: str
    price: Optional[float] = None
    currency: Optional[str] = None
    retailer: Optional[str] = None
    url: Optional[str] = None
    image_url: Optional[str] = None
    brand: Optional[str] = None
    category: Optional[str] = None
    discount_percent: Optional[float] = None
    in_stock: Optional[bool] = None


class SearchResponse(BaseModel):
    products: List[ProductResult] = Field(default_factory=list)
    total: int = 0
    query: str = ""


class CompareResponse(BaseModel):
    product_id: str
    name: str
    prices: List[Dict[str, Any]] = Field(default_factory=list)


def _make_tools(client: BuyWhereClient) -> List[FunctionTool]:
    def search_products(
        q: str,
        limit: int = 10,
        min_price: Optional[float] = None,
        max_price: Optional[float] = None,
        retailer: Optional[str] = None,
        country: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Search for products across all retailers by keyword.

        Args:
            q: Search query string (e.g. 'wireless headphones').
            limit: Maximum number of results to return (1-50, default 10).
            min_price: Minimum price filter.
            max_price: Maximum price filter.
            retailer: Filter by retailer slug (e.g. 'lazada_sg', 'shopee_sg').
            country: ISO country code filter (e.g. 'SG', 'MY', 'US').
        """
        params: Dict[str, Any] = {"q": q, "limit": limit}
        if min_price is not None:
            params["min_price"] = min_price
        if max_price is not None:
            params["max_price"] = max_price
        if retailer:
            params["retailer"] = retailer
        if country:
            params["country"] = country
        return client.get("/v1/products/search", params=params)

    def get_product(product_id: str) -> Dict[str, Any]:
        """Fetch a single product by its BuyWhere product ID.

        Args:
            product_id: The BuyWhere product identifier (e.g. '78234').
        """
        return client.get(f"/v1/products/{product_id}")

    def compare_prices(product_id: str) -> Dict[str, Any]:
        """Compare prices for a product across all retailers that carry it.

        Args:
            product_id: The BuyWhere product identifier to compare prices for.
        """
        return client.get(f"/v1/products/{product_id}/compare")

    def find_deals(
        min_discount: int = 20,
        limit: int = 10,
        category: Optional[str] = None,
        country: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Find products with the biggest price discounts right now.

        Args:
            min_discount: Minimum discount percentage to include (default 20).
            limit: Maximum number of deals to return (1-50, default 10).
            category: Filter by category slug.
            country: ISO country code filter (e.g. 'SG', 'MY', 'US').
        """
        params: Dict[str, Any] = {"min_discount": min_discount, "limit": limit}
        if category:
            params["category"] = category
        if country:
            params["country"] = country
        return client.get("/v1/products/deals", params=params)

    def browse_categories(country: Optional[str] = None) -> Dict[str, Any]:
        """List all available product categories on BuyWhere.

        Args:
            country: ISO country code to filter categories by availability (e.g. 'SG').
        """
        params: Dict[str, Any] = {}
        if country:
            params["country"] = country
        return client.get("/v1/categories", params=params)

    def get_category_products(
        category_slug: str,
        limit: int = 10,
        sort: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Get products within a specific category.

        Args:
            category_slug: The category identifier slug (e.g. 'electronics', 'health-beauty').
            limit: Maximum number of products to return (1-50, default 10).
            sort: Sort order — 'price_asc', 'price_desc', 'discount_desc', or 'relevance'.
        """
        params: Dict[str, Any] = {"limit": limit}
        if sort:
            params["sort"] = sort
        return client.get(f"/v1/categories/{category_slug}/products", params=params)

    return [
        FunctionTool.from_defaults(fn=search_products),
        FunctionTool.from_defaults(fn=get_product),
        FunctionTool.from_defaults(fn=compare_prices),
        FunctionTool.from_defaults(fn=find_deals),
        FunctionTool.from_defaults(fn=browse_categories),
        FunctionTool.from_defaults(fn=get_category_products),
    ]


def create_buywhere_tools(
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
) -> List[FunctionTool]:
    """Create LlamaIndex FunctionTool instances for the BuyWhere API.

    Args:
        api_key: BuyWhere API key. Falls back to BUYWHERE_API_KEY env var.
        base_url: BuyWhere API base URL. Falls back to BUYWHERE_BASE_URL env var,
            then https://api.buywhere.ai.

    Returns:
        List of LlamaIndex FunctionTool instances ready to pass to an agent.
    """
    client = BuyWhereClient(api_key=api_key, base_url=base_url)
    return _make_tools(client)
