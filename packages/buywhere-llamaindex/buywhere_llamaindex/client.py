"""BuyWhere HTTP client with retry/backoff for the product catalog API."""

from __future__ import annotations

import os
from typing import Any, Dict, Optional

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception

DEFAULT_BASE_URL = "https://api.buywhere.ai"
DEFAULT_TIMEOUT = 30.0
MAX_RETRIES = 3


class BuyWhereAuthError(Exception):
    pass


class BuyWhereAPIError(Exception):
    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(f"HTTP {status_code}: {message}")
        self.status_code = status_code


class BuyWhereNetworkError(Exception):
    pass


def _is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, BuyWhereAPIError):
        return exc.status_code == 429
    return isinstance(exc, (httpx.TimeoutException, httpx.NetworkError, BuyWhereNetworkError))


class BuyWhereClient:
    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> None:
        self.api_key = api_key or os.environ.get("BUYWHERE_API_KEY", "")
        self.base_url = (base_url or os.environ.get("BUYWHERE_BASE_URL", DEFAULT_BASE_URL)).rstrip("/")
        self._client = httpx.Client(
            base_url=self.base_url,
            headers={"Authorization": f"Bearer {self.api_key}", "User-Agent": "buywhere-llamaindex/0.1.0"},
            timeout=timeout,
        )

    @retry(
        retry=retry_if_exception(_is_retryable),
        stop=stop_after_attempt(MAX_RETRIES),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        reraise=True,
    )
    def get(self, path: str, params: Optional[Dict[str, Any]] = None) -> Any:
        try:
            response = self._client.get(path, params=params)
        except httpx.TimeoutException as exc:
            raise BuyWhereNetworkError(f"Request timed out: {exc}") from exc
        except httpx.NetworkError as exc:
            raise BuyWhereNetworkError(f"Network error: {exc}") from exc

        if response.status_code == 401:
            raise BuyWhereAuthError("Invalid or missing BUYWHERE_API_KEY")
        if response.status_code == 429:
            raise BuyWhereAPIError(429, "Rate limit exceeded")
        if not response.is_success:
            raise BuyWhereAPIError(response.status_code, response.text[:200])

        return response.json()

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "BuyWhereClient":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()
