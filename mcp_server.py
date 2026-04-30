"""
BuyWhere MCP Server (BUY-347)

Exposes the BuyWhere product catalog to AI agents via the Model Context
Protocol (MCP). Supports both STDIO and HTTP transport.

Run with:
  python mcp_server.py                    # STDIO mode
  python mcp_server.py --http              # HTTP mode (streamable HTTP)

Configure via environment variables:
  BUYWHERE_API_KEY     — your BuyWhere API key (required for HTTP auth)
  BUYWHERE_API_URL     — base URL (default: http://localhost:8000)
  BUYWHERE_MCP_HTTP_PORT — HTTP port (default: 8080)
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys
from typing import Any

import httpx
import redis.asyncio as redis
from mcp.server.fastmcp import FastMCP
from mcp.types import CallToolResult, TextContent

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)

API_BASE_URL = os.environ.get("BUYWHERE_API_URL", "http://localhost:8000")
API_KEY = os.environ.get("BUYWHERE_API_KEY", "")
DEFAULT_LIMIT = 10

if not API_KEY:
    logger.warning("BUYWHERE_API_KEY is not set — requests may be rejected")

mcp = FastMCP(
    "buywhere",
    host="0.0.0.0",
    port=int(os.environ.get("BUYWHERE_MCP_HTTP_PORT", "8080")),
    mount_path="/",
    streamable_http_path="/mcp",
    json_response=True,
    stateless_http=True,
)

_REDIS_URL = os.environ.get("BUYWHERE_REDIS_URL", "")


async def _health_check(request):
    from starlette.responses import JSONResponse
    if _REDIS_URL:
        try:
            r = redis.Redis.from_url(_REDIS_URL, socket_connect_timeout=2)
            await r.ping()
            await r.aclose()
        except Exception:
            return JSONResponse({"status": "redis_unavailable"}, status_code=503)
    return JSONResponse({"status": "ok"})


@mcp.custom_route("/health", ["GET"], name="health")
async def health_check(request):
    return await _health_check(request)


@mcp.tool()
async def search_products(
    query: str,
    category: str | None = None,
    min_price: float | None = None,
    max_price: float | None = None,
    source: str | None = None,
    limit: int = 10,
) -> TextContent:
    """Search the BuyWhere product catalog by keyword. Returns ranked results from Singapore e-commerce platforms."""
    params: dict[str, Any] = {"q": query, "limit": min(limit, 50)}
    for key, val in (("category", category), ("min_price", min_price), ("max_price", max_price), ("source", source)):
        if val is not None:
            params[key] = val

    try:
        data = await _api_get("/v1/products", params)
    except Exception as exc:
        logger.exception("search_products API error for %r", query)
        return TextContent(type="text", text=f"Search failed: {exc}")

    items = data.get("items", []) if isinstance(data, dict) else []
    if not items:
        return TextContent(type="text", text=f"No products found for: {query}")

    lines = [f"Found {len(items)} product(s) for **{query}**:\n"]
    for i, p in enumerate(items, 1):
        lines.append(_fmt_product_summary(i, p))
    return TextContent(type="text", text="\n".join(lines))


@mcp.tool()
async def get_product(product_id: int) -> TextContent:
    """Retrieve full details for a specific product by its BuyWhere ID."""
    try:
        data = await _api_get(f"/v1/products/{product_id}")
    except Exception as exc:
        logger.exception("get_product API error for id %r", product_id)
        return TextContent(type="text", text=f"Fetch failed: {exc}")
    return TextContent(type="text", text=_fmt_product_detail(data))


@mcp.tool()
async def find_best_price(product_name: str, category: str | None = None) -> TextContent:
    """Find the single cheapest listing for a product across all Singapore e-commerce platforms."""
    params: dict[str, Any] = {"q": product_name}
    if category:
        params["category"] = category

    try:
        p = await _api_get("/v1/products/best-price", params)
    except Exception as exc:
        logger.exception("find_best_price API error for %r", product_name)
        return TextContent(type="text", text=f"Search failed: {exc}")

    if not p or not isinstance(p, dict):
        return TextContent(type="text", text=f"No products found for: {product_name}")

    price_str = _fmt_price(p.get("price"), p.get("currency", "SGD"))
    affiliate = p.get("affiliate_url") or p.get("buy_url") or ""
    lines = [
        f"## Best Price: {p.get('name', 'Unknown')}",
        f"**Platform:** {p.get('source', 'unknown')}",
        f"**Price:** {price_str}",
        f"**Category:** {p.get('category') or 'N/A'}",
    ]
    if affiliate:
        lines.append(f"**Affiliate URL:** {affiliate}")
    lines.append(f"**Product ID:** {p.get('id', '')}")
    return TextContent(type="text", text="\n".join(lines))


@mcp.tool()
async def get_deals(
    category: str | None = None,
    min_discount_pct: float = 10,
    limit: int = 10,
) -> TextContent:
    """Find products with significant price drops compared to their original price."""
    params: dict[str, Any] = {"min_discount_pct": min_discount_pct, "limit": min(limit, 50)}
    if category:
        params["category"] = category

    try:
        data = await _api_get("/v1/deals", params)
    except Exception as exc:
        logger.exception("get_deals API error")
        return TextContent(type="text", text=f"Deals fetch failed: {exc}")

    items = data.get("items", []) if isinstance(data, dict) else []
    if not items:
        return TextContent(type="text", text=f"No deals found with >={min_discount_pct}% discount.")

    lines = [f"Found {len(items)} deal(s) with >={min_discount_pct}% discount:\n"]
    for i, d in enumerate(items, 1):
        current = _fmt_price(d.get("price"), d.get("currency", "SGD"))
        original = _fmt_price(d.get("original_price"), d.get("currency", "SGD")) if d.get("original_price") else "N/A"
        discount = d.get("discount_pct", 0) or 0
        lines.append(
            f"{i}. **{d.get('name', 'Unknown')}**\n"
            f"   Current: {current} | Was: {original} | Discount: {discount}%\n"
            f"   Platform: {d.get('source', 'unknown')} | ID: {d.get('id', '')}\n"
        )
    return TextContent(type="text", text="\n".join(lines))


async def _api_get(path: str, params: dict[str, Any] | None = None) -> Any:
    headers: dict[str, str] = {"Accept": "application/json"}
    if API_KEY:
        headers["Authorization"] = f"Bearer {API_KEY}"
    async with httpx.AsyncClient(base_url=API_BASE_URL, headers=headers, timeout=10.0) as client:
        resp = await client.get(path, params=params or {})
        resp.raise_for_status()
        return resp.json()


def _fmt_price(price: Any, currency: str = "SGD") -> str:
    if price is None:
        return "N/A"
    try:
        return f"{currency} {float(price):.2f}"
    except (TypeError, ValueError):
        return str(price)


def _fmt_product_summary(index: int, p: dict[str, Any]) -> str:
    name = p.get("name") or p.get("title") or "Unknown"
    price = _fmt_price(p.get("price"), p.get("currency", "SGD"))
    source = p.get("source", "unknown")
    pid = p.get("id", "")
    url = p.get("affiliate_url") or p.get("buy_url") or ""
    url_line = f"\n   URL: {url}" if url else ""
    return f"{index}. **{name}**\n   Price: {price} | Platform: {source}{url_line}\n   ID: {pid}\n"


def _fmt_product_detail(p: dict[str, Any]) -> str:
    if not isinstance(p, dict):
        return str(p)
    lines = [f"## {p.get('name') or 'Product'}"]
    for key, label in [
        ("id", "ID"),
        ("source", "Platform"),
        ("price", "Price"),
        ("currency", "Currency"),
        ("category", "Category"),
        ("affiliate_url", "Affiliate URL"),
        ("buy_url", "Buy URL"),
        ("image_url", "Image"),
    ]:
        val = p.get(key)
        if val is not None:
            lines.append(f"**{label}:** {val}")
    return "\n".join(lines)


async def main() -> None:
    http_mode = "--http" in sys.argv
    if http_mode:
        logger.info("BuyWhere MCP server starting in HTTP mode (API: %s)", API_BASE_URL)
        await mcp.run_streamable_http_async()
    else:
        logger.info("BuyWhere MCP server starting in STDIO mode (API: %s)", API_BASE_URL)
        await mcp.run_stdio_async()


if __name__ == "__main__":
    asyncio.run(main())
