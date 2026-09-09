from __future__ import annotations

import json
import time
from typing import Any

import httpx

from .tools import BuyWhereToolName

DEFAULT_BASE_URL = "https://api.buywhere.ai"
DEFAULT_TIMEOUT = 30.0
MAX_RETRIES = 3


class BuyWhereClient:
    def __init__(
        self,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._client = httpx.Client(base_url=self._base_url, timeout=timeout)
        self._async_client = httpx.AsyncClient(base_url=self._base_url, timeout=timeout)

    def dispatch(self, tool_call: dict[str, Any]) -> Any:
        name = tool_call["function"]["name"]
        args = json.loads(tool_call["function"]["arguments"])

        handlers: dict[str, Any] = {
            "search_products": lambda: self.search_products(**args),
            "get_product": lambda: self.get_product(args["id"]),
            "compare_products": lambda: self.compare_products(args["ids"]),
            "get_deals": lambda: self.get_deals(**args),
            "list_categories": lambda: self.list_categories(**args),
        }

        handler = handlers.get(name)
        if handler is None:
            raise ValueError(f"Unknown function: {name}")
        return handler()

    async def dispatch_async(self, tool_call: dict[str, Any]) -> Any:
        name = tool_call["function"]["name"]
        args = json.loads(tool_call["function"]["arguments"])

        handlers: dict[str, Any] = {
            "search_products": lambda: self.search_products_async(**args),
            "get_product": lambda: self.get_product_async(args["id"]),
            "compare_products": lambda: self.compare_products_async(args["ids"]),
            "get_deals": lambda: self.get_deals_async(**args),
            "list_categories": lambda: self.list_categories_async(**args),
        }

        handler = handlers.get(name)
        if handler is None:
            raise ValueError(f"Unknown function: {name}")
        return await handler()

    def search_products(self, **params: Any) -> Any:
        query = self._build_search_query(params)
        return self._request("GET", f"/v1/products/search?{query}")

    async def search_products_async(self, **params: Any) -> Any:
        query = self._build_search_query(params)
        return await self._request_async("GET", f"/v1/products/search?{query}")

    def get_product(self, product_id: str) -> Any:
        return self._request("GET", f"/v1/products/{product_id}")

    async def get_product_async(self, product_id: str) -> Any:
        return await self._request_async("GET", f"/v1/products/{product_id}")

    def compare_products(self, ids: list[str]) -> Any:
        return self._request("GET", f"/v1/products/compare?ids={','.join(ids)}")

    async def compare_products_async(self, ids: list[str]) -> Any:
        return await self._request_async(
            "GET", f"/v1/products/compare?ids={','.join(ids)}"
        )

    def get_deals(self, **params: Any) -> Any:
        query = self._build_deals_query(params)
        return self._request("GET", f"/v1/products/deals?{query}")

    async def get_deals_async(self, **params: Any) -> Any:
        query = self._build_deals_query(params)
        return await self._request_async("GET", f"/v1/products/deals?{query}")

    def list_categories(self, **params: Any) -> Any:
        query = ""
        if params.get("currency"):
            query = f"currency={params['currency']}"
        return self._request("GET", f"/v1/categories?{query}")

    async def list_categories_async(self, **params: Any) -> Any:
        query = ""
        if params.get("currency"):
            query = f"currency={params['currency']}"
        return await self._request_async("GET", f"/v1/categories?{query}")

    def _request(self, method: str, path: str, attempt: int = 1) -> Any:
        response = self._client.request(
            method,
            path,
            headers=self._headers(),
        )
        if not response.is_success:
            should_retry = (response.status_code == 429 or response.status_code >= 500) and attempt < MAX_RETRIES
            if should_retry:
                delay = min(1000 * (2 ** (attempt - 1)), 8000) / 1000
                time.sleep(delay)
                return self._request(method, path, attempt + 1)
            response.raise_for_status()
        return response.json()

    async def _request_async(self, method: str, path: str, attempt: int = 1) -> Any:
        response = await self._async_client.request(
            method,
            path,
            headers=self._headers(),
        )
        if not response.is_success:
            should_retry = (response.status_code == 429 or response.status_code >= 500) and attempt < MAX_RETRIES
            if should_retry:
                delay = min(1000 * (2 ** (attempt - 1)), 8000) / 1000
                await self._async_sleep(delay)
                return await self._request_async(method, path, attempt + 1)
            response.raise_for_status()
        return response.json()

    @staticmethod
    async def _async_sleep(delay: float) -> None:
        import asyncio
        await asyncio.sleep(delay)

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

    @staticmethod
    def _build_search_query(params: dict[str, Any]) -> str:
        import urllib.parse

        qs: dict[str, str] = {}
        if params.get("q"):
            qs["q"] = str(params["q"])
        if params.get("country_code"):
            qs["country_code"] = str(params["country_code"])
        if params.get("domain"):
            qs["domain"] = str(params["domain"])
        if params.get("currency"):
            qs["currency"] = str(params["currency"])
        if params.get("min_price") is not None:
            qs["min_price"] = str(params["min_price"])
        if params.get("max_price") is not None:
            qs["max_price"] = str(params["max_price"])
        if params.get("limit") is not None:
            qs["limit"] = str(params["limit"])
        if params.get("offset") is not None:
            qs["offset"] = str(params["offset"])
        if params.get("compact") is not None:
            qs["compact"] = str(params["compact"])
        return urllib.parse.urlencode(qs)

    @staticmethod
    def _build_deals_query(params: dict[str, Any]) -> str:
        import urllib.parse

        qs: dict[str, str] = {}
        if params.get("country_code"):
            qs["country_code"] = str(params["country_code"])
        if params.get("currency"):
            qs["currency"] = str(params["currency"])
        if params.get("min_discount") is not None:
            qs["min_discount"] = str(params["min_discount"])
        if params.get("limit") is not None:
            qs["limit"] = str(params["limit"])
        if params.get("offset") is not None:
            qs["offset"] = str(params["offset"])
        return urllib.parse.urlencode(qs)

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> BuyWhereClient:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()
