"""
LangChain Tool Adapter for BuyWhere
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Wraps the BuyWhere SDK as LangChain ``BaseTool`` subclasses for use in
LangChain agents and CrewAI workflows.

Usage::

    from buywhere_sdk import BuyWhere
    from buywhere_sdk.langchain import BuyWhereSearchTool, BuyWhereGetProductTool

    # As LangChain tools
    search_tool = BuyWhereSearchTool(api_key="bw_live_xxxxx")
    get_product_tool = BuyWhereGetProductTool(api_key="bw_live_xxxxx")

    # Or use the composite toolset
    tools = BuyWhereToolkit(api_key="bw_live_xxxxx")

    # In a LangChain agent
    agent = create_agent(tools, llm, prompt)
    agent.invoke({"input": "find the cheapest dyson vacuum in singapore"})
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Type

try:
    from langchain_core.callbacks.manager import CallbackManagerForToolRun
except ImportError:
    from langchain.callbacks.manager import CallbackManagerForToolRun  # type: ignore

try:
    from langchain.pydantic_v1 import BaseModel, Field
except ImportError:
    from pydantic import BaseModel, Field  # type: ignore

try:
    from langchain.tools import BaseTool
except ImportError:
    from langchain_core.tools import BaseTool  # type: ignore

from buywhere_sdk import BuyWhere, AsyncBuyWhere
from buywhere_sdk.exceptions import BuyWhereError


class SearchInput(BaseModel):
    """Input schema for the search tool."""

    query: str = Field(
        description="Full-text search query for products (e.g. 'dyson vacuum', 'nike running shoes')"
    )
    category: Optional[str] = Field(
        None,
        description="Filter by category name (case-insensitive partial match, e.g. 'Electronics', 'Sports')",
    )
    min_price: Optional[float] = Field(
        None, description="Minimum price filter in SGD"
    )
    max_price: Optional[float] = Field(
        None, description="Maximum price filter in SGD"
    )
    limit: int = Field(
        default=10, ge=1, le=100, description="Number of results to return (1-100)"
    )


class GetProductInput(BaseModel):
    """Input schema for the get_product tool."""

    product_id: int = Field(
        description="The BuyWhere product ID to retrieve"
    )


class BestPriceInput(BaseModel):
    """Input schema for the best_price tool."""

    query: str = Field(
        description="Product name to search for (e.g. 'Nintendo Switch OLED', 'Apple AirPods Pro')"
    )
    category: Optional[str] = Field(
        None, description="Optional category filter to narrow search"
    )


class BuyWhereSearchTool(BaseTool):
    """LangChain tool for searching products in the BuyWhere catalog.

    Example::

        from langchain.agents import initialize_agent

        tool = BuyWhereSearchTool(api_key="bw_live_xxxxx")
        result = tool.run("wireless headphones singapore")
    """

    name: str = "buywhere_search"
    description: str = (
        "Search the BuyWhere product catalog. "
        "Returns a list of matching products with prices, URLs, and availability. "
        "Use this when you need to find products by name, brand, or description. "
        "Input should be a JSON object with 'query' (required), and optionally "
        "'category', 'min_price', 'max_price', and 'limit'."
    )
    args_schema: Type[BaseModel] = SearchInput

    api_key: str = Field(default="", description="BuyWhere API key")
    base_url: Optional[str] = Field(
        default=None, description="Optional custom base URL"
    )
    timeout: float = Field(default=30.0, description="Request timeout in seconds")

    def __init__(
        self,
        api_key: str,
        base_url: Optional[str] = None,
        timeout: float = 30.0,
        **kwargs,
    ):
        super().__init__(api_key=api_key, base_url=base_url, timeout=timeout, **kwargs)

    def _run(
        self,
        query: str,
        category: Optional[str] = None,
        min_price: Optional[float] = None,
        max_price: Optional[float] = None,
        limit: int = 10,
        run_manager: Optional[CallbackManagerForToolRun] = None,
    ) -> str:
        """Execute the search."""
        try:
            client = BuyWhere(
                api_key=self.api_key,
                base_url=self.base_url or "https://api.buywhere.ai",
                timeout=self.timeout,
            )
            results = client.search(
                query=query,
                category=category,
                min_price=min_price,
                max_price=max_price,
                limit=limit,
            )
            if not results.items:
                return f"No products found for query: {query}"

            lines = [f"Found {results.total} products for '{query}':\n"]
            for i, product in enumerate(results.items[:limit], 1):
                lines.append(
                    f"{i}. {product.name} — {product.currency} {product.price} "
                    f"({product.source}) [ID: {product.id}]"
                )
                if product.buy_url:
                    lines.append(f"   URL: {product.buy_url}")
            return "\n".join(lines)
        except BuyWhereError as e:
            return f"BuyWhere API error: {e.message}"


class BuyWhereGetProductTool(BaseTool):
    """LangChain tool for retrieving a single product by BuyWhere ID.

    Example::

        tool = BuyWhereGetProductTool(api_key="bw_live_xxxxx")
        result = tool.run("12345")
    """

    name: str = "buywhere_get_product"
    description: str = (
        "Get detailed information about a single product by its BuyWhere product ID. "
        "Returns full product details including price, description, availability, and URLs. "
        "Input should be the product ID as an integer."
    )
    args_schema: Type[BaseModel] = GetProductInput

    api_key: str = Field(default="", description="BuyWhere API key")
    base_url: Optional[str] = Field(
        default=None, description="Optional custom base URL"
    )
    timeout: float = Field(default=30.0, description="Request timeout in seconds")

    def __init__(
        self,
        api_key: str,
        base_url: Optional[str] = None,
        timeout: float = 30.0,
        **kwargs,
    ):
        super().__init__(api_key=api_key, base_url=base_url, timeout=timeout, **kwargs)

    def _run(
        self,
        product_id: int,
        run_manager: Optional[CallbackManagerForToolRun] = None,
    ) -> str:
        """Execute the product lookup."""
        try:
            client = BuyWhere(
                api_key=self.api_key,
                base_url=self.base_url or "https://api.buywhere.ai",
                timeout=self.timeout,
            )
            product = client.get_product(product_id)
            lines = [
                f"Product: {product.name}",
                f"ID: {product.id} | SKU: {product.sku}",
                f"Price: {product.currency} {product.price}",
                f"Source: {product.source}",
                f"Brand: {product.brand or 'N/A'}",
                f"Category: {product.category or 'N/A'}",
                f"Availability: {'In Stock' if product.availability else 'Out of Stock'}",
                f"Buy URL: {product.buy_url}",
            ]
            if product.affiliate_url:
                lines.append(f"Affiliate URL: {product.affiliate_url}")
            if product.image_url:
                lines.append(f"Image: {product.image_url}")
            if product.description:
                lines.append(f"\nDescription: {product.description[:500]}")
            return "\n".join(lines)
        except BuyWhereError as e:
            return f"BuyWhere API error: {e.message}"


class BuyWhereBestPriceTool(BaseTool):
    """LangChain tool for finding the cheapest listing across all platforms.

    Example::

        tool = BuyWhereBestPriceTool(api_key="bw_live_xxxxx")
        result = tool.run('{"query": "nintendo switch oled"}')
    """

    name: str = "buywhere_best_price"
    description: str = (
        "Find the single cheapest listing for a product across all Singapore e-commerce platforms. "
        "Use this when you want to find the best deal on a specific product. "
        "Input should be a JSON object with 'query' (required) and optionally 'category'."
    )
    args_schema: Type[BaseModel] = BestPriceInput

    api_key: str = Field(default="", description="BuyWhere API key")
    base_url: Optional[str] = Field(
        default=None, description="Optional custom base URL"
    )
    timeout: float = Field(default=30.0, description="Request timeout in seconds")

    def __init__(
        self,
        api_key: str,
        base_url: Optional[str] = None,
        timeout: float = 30.0,
        **kwargs,
    ):
        super().__init__(api_key=api_key, base_url=base_url, timeout=timeout, **kwargs)

    def _run(
        self,
        query: str,
        category: Optional[str] = None,
        run_manager: Optional[CallbackManagerForToolRun] = None,
    ) -> str:
        """Execute the best price search."""
        try:
            client = BuyWhere(
                api_key=self.api_key,
                base_url=self.base_url or "https://api.buywhere.ai",
                timeout=self.timeout,
            )
            product = client.best_price(query=query, category=category)
            lines = [
                f"Best Price Found: {product.name}",
                f"Price: {product.currency} {product.price}",
                f"Source: {product.source}",
                f"Buy URL: {product.buy_url}",
                f"Availability: {'In Stock' if product.availability else 'Out of Stock'}",
            ]
            return "\n".join(lines)
        except BuyWhereError as e:
            return f"BuyWhere API error: {e.message}"


class BuyWhereToolkit:
    """A toolkit containing all BuyWhere tools for LangChain agents.

    Example::

        from langchain.agents import initialize_agent

        toolkit = BuyWhereToolkit(api_key="bw_live_xxxxx")
        agent = initialize_agent(
            toolkit.get_tools(),
            llm,
            agent="zero-shot-react-description",
            verbose=True
        )
        agent.run("find the cheapest dyson vacuum in singapore")
    """

    def __init__(
        self,
        api_key: str,
        base_url: Optional[str] = None,
        timeout: float = 30.0,
    ):
        self.api_key = api_key
        self.base_url = base_url
        self.timeout = timeout

    def get_tools(self) -> List[BaseTool]:
        """Return all BuyWhere tools."""
        return [
            BuyWhereSearchTool(
                api_key=self.api_key,
                base_url=self.base_url,
                timeout=self.timeout,
            ),
            BuyWhereGetProductTool(
                api_key=self.api_key,
                base_url=self.base_url,
                timeout=self.timeout,
            ),
            BuyWhereBestPriceTool(
                api_key=self.api_key,
                base_url=self.base_url,
                timeout=self.timeout,
            ),
        ]


__all__ = [
    "SearchInput",
    "GetProductInput",
    "BestPriceInput",
    "BuyWhereSearchTool",
    "BuyWhereGetProductTool",
    "BuyWhereBestPriceTool",
    "BuyWhereToolkit",
]
