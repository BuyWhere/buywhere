from __future__ import annotations

import httpx
from urllib.parse import urljoin
from typing import Optional, Sequence

from .models import (
    Product,
    ProductList,
    CategoryList,
    DealList,
    DealItem,
    ApiInfo,
    HealthStatus,
)
from .exceptions import (
    AuthenticationError,
    RateLimitError,
    NotFoundError,
    ValidationError,
    ServerError,
    BuyWhereError,
)


DEFAULT_BASE_URL = "https://api.buywhere.ai"
DEFAULT_TIMEOUT = 30.0


class BuyWhere:
    """
    Python client for the BuyWhere product catalog API.

    Ideal for AI agents that need to search, compare, and purchase products
    across Singapore and global e-commerce platforms.

    Usage::

        from buywhere_sdk import BuyWhere

        client = BuyWhere(api_key="bw_live_xxxxx")
        results = client.search("dyson vacuum cleaner")
        print(results.items[0].buy_url)
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
        async_client: Optional[httpx.AsyncClient] = None,
    ):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._sync_client: Optional[httpx.Client] = None
        self._async_client = async_client

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "User-Agent": "buywhere-sdk/0.1.0",
            "Accept": "application/json",
        }

    def _handle_error(self, response: httpx.Response) -> None:
        status = response.status_code
        detail = response.json().get("detail", response.text) if response.text else response.text

        if status == 401 or status == 403:
            raise AuthenticationError(f"Authentication failed: {detail}", status_code=status)
        if status == 404:
            raise NotFoundError(f"Resource not found: {detail}", status_code=status)
        if status == 429:
            raise RateLimitError(f"Rate limit exceeded: {detail}", status_code=status)
        if status == 422:
            raise ValidationError(f"Validation error: {detail}", status_code=status)
        if status >= 500:
            raise ServerError(f"Server error: {detail}", status_code=status)
        raise BuyWhereError(f"Unexpected error: {detail}", status_code=status)

    def search(
        self,
        query: Optional[str] = None,
        *,
        category: Optional[str] = None,
        min_price: Optional[float] = None,
        max_price: Optional[float] = None,
        source: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
    ) -> ProductList:
        """
        Search products by query string, category, price range, or source.

        Args:
            query: Full-text search query (e.g. "dyson vacuum")
            category: Filter by category name (case-insensitive partial match)
            min_price: Minimum price filter (SGD)
            max_price: Maximum price filter (SGD)
            source: Filter by source platform (e.g. "lazada_sg", "shopee_sg")
            limit: Number of results per page (1-100, default 20)
            offset: Pagination offset (default 0)

        Returns:
            ProductList with total count and paginated items
        """
        params = {"limit": limit, "offset": offset}
        if query:
            params["q"] = query
        if category:
            params["category"] = category
        if min_price is not None:
            params["min_price"] = min_price
        if max_price is not None:
            params["max_price"] = max_price
        if source:
            params["source"] = source

        response = httpx.get(
            urljoin(self.base_url, "/v1/search"),
            params=params,
            headers=self._headers(),
            timeout=self.timeout,
        )
        if not response.is_success:
            self._handle_error(response)
        return ProductList.model_validate(response.json())

    def get_product(self, product_id: int) -> Product:
        """
        Get a single product by its BuyWhere ID.

        Args:
            product_id: The BuyWhere product ID

        Returns:
            Product object

        Raises:
            NotFoundError: If product does not exist or is inactive
        """
        response = httpx.get(
            urljoin(self.base_url, f"/v1/products/{product_id}"),
            headers=self._headers(),
            timeout=self.timeout,
        )
        if not response.is_success:
            self._handle_error(response)
        return Product.model_validate(response.json())

    def best_price(
        self,
        query: str,
        *,
        category: Optional[str] = None,
    ) -> Product:
        """
        Find the single cheapest listing for a product across all platforms.

        Uses full-text search to find matching products, then returns the lowest-priced one.
        Falls back to case-insensitive substring matching if exact search yields no results.

        Args:
            query: Product name to search for (e.g. "Nintendo Switch OLED")
            category: Optional category filter

        Returns:
            The cheapest matching Product

        Raises:
            NotFoundError: If no products match the query
        """
        params = {"q": query}
        if category:
            params["category"] = category

        response = httpx.get(
            urljoin(self.base_url, "/v1/products/best-price"),
            params=params,
            headers=self._headers(),
            timeout=self.timeout,
        )
        if not response.is_success:
            self._handle_error(response)
        return Product.model_validate(response.json())

    def compare_prices(self, query: str, *, category: Optional[str] = None) -> Product:
        """
        Alias for best_price() — find the cheapest listing for a product.

        This is the convenience method name specified in the SDK contract.
        """
        return self.best_price(query=query, category=category)

    def list_categories(self) -> CategoryList:
        """
        List all available product categories with item counts.

        Categories are sorted by product count (most-popular first).

        Returns:
            CategoryList with all categories and total count
        """
        response = httpx.get(
            urljoin(self.base_url, "/v1/categories"),
            headers=self._headers(),
            timeout=self.timeout,
        )
        if not response.is_success:
            self._handle_error(response)
        return CategoryList.model_validate(response.json())

    def get_deals(
        self,
        *,
        category: Optional[str] = None,
        min_discount_pct: float = 10.0,
        limit: int = 20,
        offset: int = 0,
    ) -> DealList:
        """
        Get products currently priced below their original/historical price.

        Args:
            category: Filter by category name (optional)
            min_discount_pct: Minimum discount percentage (default 10, range 0-100)
            limit: Number of results per page (1-100, default 20)
            offset: Pagination offset (default 0)

        Returns:
            DealList with discounted products sorted by discount depth
        """
        params = {
            "min_discount_pct": min_discount_pct,
            "limit": limit,
            "offset": offset,
        }
        if category:
            params["category"] = category

        response = httpx.get(
            urljoin(self.base_url, "/v1/deals"),
            params=params,
            headers=self._headers(),
            timeout=self.timeout,
        )
        if not response.is_success:
            self._handle_error(response)
        return DealList.model_validate(response.json())

    def health_check(self) -> HealthStatus:
        """Check API health status and version info."""
        response = httpx.get(
            urljoin(self.base_url, "/health"),
            headers=self._headers(),
            timeout=self.timeout,
        )
        if not response.is_success:
            self._handle_error(response)
        return HealthStatus.model_validate(response.json())

    def api_info(self) -> ApiInfo:
        """Get API metadata including available endpoints."""
        response = httpx.get(
            urljoin(self.base_url, "/v1"),
            headers=self._headers(),
            timeout=self.timeout,
        )
        if not response.is_success:
            self._handle_error(response)
        return ApiInfo.model_validate(response.json())


class AsyncBuyWhere:
    """
    Async Python client for the BuyWhere product catalog API.

    Suitable for use in async frameworks (FastAPI, LangChain async tools, etc.)
    or any asyncio-based AI agent workflow.

    Usage::

        from buywhere_sdk import AsyncBuyWhere

        async def find_cheapest():
            async with AsyncBuyWhere(api_key="bw_live_xxxxx") as client:
                return await client.best_price("playstation 5")
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
    ):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "User-Agent": "buywhere-sdk/0.1.0",
                    "Accept": "application/json",
                },
                timeout=self.timeout,
            )
        return self._client

    async def _handle_error(self, response: httpx.Response) -> None:
        status = response.status_code
        detail = response.json().get("detail", response.text) if response.text else response.text

        if status == 401 or status == 403:
            raise AuthenticationError(f"Authentication failed: {detail}", status_code=status)
        if status == 404:
            raise NotFoundError(f"Resource not found: {detail}", status_code=status)
        if status == 429:
            raise RateLimitError(f"Rate limit exceeded: {detail}", status_code=status)
        if status == 422:
            raise ValidationError(f"Validation error: {detail}", status_code=status)
        if status >= 500:
            raise ServerError(f"Server error: {detail}", status_code=status)
        raise BuyWhereError(f"Unexpected error: {detail}", status_code=status)

    async def search(
        self,
        query: Optional[str] = None,
        *,
        category: Optional[str] = None,
        min_price: Optional[float] = None,
        max_price: Optional[float] = None,
        source: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
    ) -> ProductList:
        params = {"limit": limit, "offset": offset}
        if query:
            params["q"] = query
        if category:
            params["category"] = category
        if min_price is not None:
            params["min_price"] = min_price
        if max_price is not None:
            params["max_price"] = max_price
        if source:
            params["source"] = source

        client = await self._get_client()
        response = await client.get(
            urljoin(self.base_url, "/v1/search"),
            params=params,
        )
        if not response.is_success:
            await self._handle_error(response)
        return ProductList.model_validate(response.json())

    async def get_product(self, product_id: int) -> Product:
        client = await self._get_client()
        response = await client.get(
            urljoin(self.base_url, f"/v1/products/{product_id}"),
        )
        if not response.is_success:
            await self._handle_error(response)
        return Product.model_validate(response.json())

    async def best_price(
        self,
        query: str,
        *,
        category: Optional[str] = None,
    ) -> Product:
        params = {"q": query}
        if category:
            params["category"] = category

        client = await self._get_client()
        response = await client.get(
            urljoin(self.base_url, "/v1/products/best-price"),
            params=params,
        )
        if not response.is_success:
            await self._handle_error(response)
        return Product.model_validate(response.json())

    async def compare_prices(self, query: str, *, category: Optional[str] = None) -> Product:
        return await self.best_price(query=query, category=category)

    async def list_categories(self) -> CategoryList:
        client = await self._get_client()
        response = await client.get(
            urljoin(self.base_url, "/v1/categories"),
        )
        if not response.is_success:
            await self._handle_error(response)
        return CategoryList.model_validate(response.json())

    async def get_deals(
        self,
        *,
        category: Optional[str] = None,
        min_discount_pct: float = 10.0,
        limit: int = 20,
        offset: int = 0,
    ) -> DealList:
        params = {
            "min_discount_pct": min_discount_pct,
            "limit": limit,
            "offset": offset,
        }
        if category:
            params["category"] = category

        client = await self._get_client()
        response = await client.get(
            urljoin(self.base_url, "/v1/deals"),
            params=params,
        )
        if not response.is_success:
            await self._handle_error(response)
        return DealList.model_validate(response.json())

    async def health_check(self) -> HealthStatus:
        client = await self._get_client()
        response = await client.get(
            urljoin(self.base_url, "/health"),
        )
        if not response.is_success:
            await self._handle_error(response)
        return HealthStatus.model_validate(response.json())

    async def api_info(self) -> ApiInfo:
        client = await self._get_client()
        response = await client.get(
            urljoin(self.base_url, "/v1"),
        )
        if not response.is_success:
            await self._handle_error(response)
        return ApiInfo.model_validate(response.json())

    async def close(self) -> None:
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    async def __aenter__(self) -> "AsyncBuyWhere":
        return self

    async def __aexit__(self, *args) -> None:
        await self.close()
