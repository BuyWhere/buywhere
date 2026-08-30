"""Tests for buywhere-llamaindex tools."""

from unittest.mock import MagicMock, patch
import pytest

from buywhere_llamaindex import create_buywhere_tools
from buywhere_llamaindex.client import BuyWhereClient, BuyWhereAPIError, BuyWhereAuthError


def test_create_buywhere_tools_returns_list():
    tools = create_buywhere_tools(api_key="test_key")
    assert isinstance(tools, list)
    assert len(tools) == 6


def test_tool_names():
    tools = create_buywhere_tools(api_key="test_key")
    names = [t.metadata.name for t in tools]
    assert "search_products" in names
    assert "get_product" in names
    assert "compare_prices" in names
    assert "find_deals" in names
    assert "browse_categories" in names
    assert "get_category_products" in names


def test_env_var_auth_fallback(monkeypatch):
    monkeypatch.setenv("BUYWHERE_API_KEY", "env_key")
    client = BuyWhereClient()
    assert client.api_key == "env_key"


def test_explicit_key_takes_precedence(monkeypatch):
    monkeypatch.setenv("BUYWHERE_API_KEY", "env_key")
    client = BuyWhereClient(api_key="explicit_key")
    assert client.api_key == "explicit_key"


def test_search_params_forwarded():
    with patch("buywhere_llamaindex.tools.BuyWhereClient") as MockClient:
        mock_client_instance = MagicMock()
        MockClient.return_value = mock_client_instance
        mock_client_instance.get.return_value = {"products": [], "total": 0}

        tools = create_buywhere_tools(api_key="key")
        search_tool = next(t for t in tools if t.metadata.name == "search_products")
        search_tool.call(q="headphones", limit=5)

        mock_client_instance.get.assert_called_once()
        call_args = mock_client_instance.get.call_args
        assert call_args[0][0] == "/v1/products/search"
        assert call_args[1]["params"]["q"] == "headphones"
        assert call_args[1]["params"]["limit"] == 5


def test_compare_id_serialization():
    with patch("buywhere_llamaindex.tools.BuyWhereClient") as MockClient:
        mock_client_instance = MagicMock()
        MockClient.return_value = mock_client_instance
        mock_client_instance.get.return_value = {"product_id": "123", "prices": []}

        tools = create_buywhere_tools(api_key="key")
        compare_tool = next(t for t in tools if t.metadata.name == "compare_prices")
        compare_tool.call(product_id="123")

        mock_client_instance.get.assert_called_once_with("/v1/products/123/compare")


def test_429_retry_behavior():
    from buywhere_llamaindex.client import _is_retryable
    assert _is_retryable(BuyWhereAPIError(429, "rate limited")) is True
    assert _is_retryable(BuyWhereAPIError(404, "not found")) is False
    assert _is_retryable(BuyWhereAuthError("bad key")) is False
