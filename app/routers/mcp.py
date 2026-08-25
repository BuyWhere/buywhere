import contextvars
import logging
from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from app.auth import get_current_api_key
from app.models.product import ApiKey

from mcp.server import Server
from mcp.types import (
    CallToolResult,
    ListToolsResult,
    TextContent,
    Tool,
)

logger = logging.getLogger("mcp-http")

router = APIRouter(prefix="/mcp", tags=["mcp"])

# Thread the caller's Bearer token through MCP tool handler → _api_get without
# adding it to every function signature. ContextVar is safe under asyncio concurrency.
_request_auth: contextvars.ContextVar[str] = contextvars.ContextVar("mcp_auth", default="")

_api_server: Server | None = None

# Region/country alias map used across all MCP tools. Probes and callers pass
# any of {country_code, country, region} with either an ISO-2 alpha-2 code or a
# lowercase market alias (sg, us, my, th, vn, ph, gb/uk, in, au, sea). Without
# this mapping the upstream /v1/* endpoints receive unrecognized args and fall
# back to a global 28M-row scan instead of a 7.8M-row partition-pruned scan.
_REGION_TO_COUNTRY: dict[str, str] = {
    "sg": "SG",
    "us": "US",
    "my": "MY",
    "th": "TH",
    "vn": "VN",
    "ph": "PH",
    "gb": "GB",
    "uk": "GB",
    "in": "IN",
    "au": "AU",
    "sea": "SG",
}


def _normalize_country_arg(args: dict[str, Any]) -> str:
    """Return an uppercased country code from country_code/country/region args, or ''.

    Accepts the field name aliases callers actually use (country_code, country,
    region) and normalizes lowercase region keys via _REGION_TO_COUNTRY. An
    empty result means "no scope requested" — callers must decide whether to
    default (e.g. list_categories defaults to SG; search does not).
    """
    raw = args.get("country_code") or args.get("country") or args.get("region") or ""
    key = str(raw).strip().lower()
    if not key:
        return ""
    if key in _REGION_TO_COUNTRY:
        return _REGION_TO_COUNTRY[key]
    # Already an ISO-2 (or other) upper-case code — preserve original casing.
    return str(raw).strip().upper()


def get_mcp_server() -> Server:
    global _api_server
    if _api_server is None:
        server = Server("buywhere")

        @server.list_tools()
        async def list_tools() -> ListToolsResult:
            return ListToolsResult(
                tools=[
                    Tool(
                        name="search_products",
                        description=(
                            "Search the BuyWhere product catalog by keyword across Singapore, US, "
                            "and Southeast Asia. Returns products from Lazada, Shopee, Qoo10, "
                            "Amazon, Walmart, Target, and 40+ other retailers. Use country_code to "
                            "scope results to a specific market (SG, US, MY, TH, VN, PH)."
                        ),
                        inputSchema={
                            "type": "object",
                            "properties": {
                                "query": {"type": "string", "description": "Product search query."},
                                "category": {"type": "string", "description": "Optional category filter."},
                                "min_price": {"type": "number", "description": "Minimum price."},
                                "max_price": {"type": "number", "description": "Maximum price."},
                                "source": {
                                    "type": "string",
                                    "description": "Platform filter (lazada_sg, shopee_sg, amazon_us, etc.).",
                                },
                                "country_code": {
                                    "type": "string",
                                    "description": "Country filter: SG, US, MY, TH, VN, PH. Strongly recommended — without it the search spans all 28M products.",
                                },
                                "country": {
                                    "type": "string",
                                    "description": "Alias for country_code.",
                                },
                                "region": {
                                    "type": "string",
                                    "description": "Alias for country_code (sg→SG, us→US, my→MY, th→TH, vn→VN, ph→PH, gb/uk→GB, in→IN, au→AU).",
                                },
                                "limit": {
                                    "type": "integer",
                                    "description": "Max results (default 10, max 50).",
                                    "default": 10,
                                    "minimum": 1,
                                    "maximum": 50,
                                },
                            },
                            "required": ["query"],
                        },
                    ),
                    Tool(
                        name="get_product",
                        description="Retrieve full details for a specific product by its BuyWhere ID.",
                        inputSchema={
                            "type": "object",
                            "properties": {
                                "product_id": {
                                    "type": "integer",
                                    "description": "The BuyWhere product ID.",
                                },
                            },
                            "required": ["product_id"],
                        },
                    ),
                    Tool(
                        name="find_best_price",
                        description=(
                            "Find the single cheapest listing for a product. Specify country_code "
                            "to scope results to a single market and avoid cross-market scans "
                            "(strongly recommended for performance)."
                        ),
                        inputSchema={
                            "type": "object",
                            "properties": {
                                "product_name": {
                                    "type": "string",
                                    "description": "Product name or search query.",
                                },
                                "q": {
                                    "type": "string",
                                    "description": "Alias for product_name (deprecated, use product_name).",
                                },
                                "category": {
                                    "type": "string",
                                    "description": "Optional category to narrow the search.",
                                },
                                "country_code": {
                                    "type": "string",
                                    "description": "ISO-2 country code (SG, US, MY, TH, VN, PH). Scopes the scan to one partition for fast responses.",
                                },
                                "country": {
                                    "type": "string",
                                    "description": "Alias for country_code.",
                                },
                                "region": {
                                    "type": "string",
                                    "description": "Alias for country_code (sg→SG, us→US, my→MY, th→TH, vn→VN, ph→PH, gb/uk→GB, in→IN, au→AU).",
                                },
                            },
                            "required": ["product_name"],
                        },
                    ),
                    Tool(
                        name="get_deals",
                        description=(
                            "Find products with significant price drops compared to their original "
                            "price. Returns deals sorted by discount percentage with current price, "
                            "original price, and savings."
                        ),
                        inputSchema={
                            "type": "object",
                            "properties": {
                                "category": {
                                    "type": "string",
                                    "description": "Optional category filter (e.g. 'electronics').",
                                },
                                "country_code": {
                                    "type": "string",
                                    "description": "ISO country code (SG, US, MY, TH, VN, GB, IN, AU).",
                                },
                                "country": {
                                    "type": "string",
                                    "description": "Alias for country_code.",
                                },
                                "region": {
                                    "type": "string",
                                    "description": "Alias for country_code (sg→SG, us→US, my→MY, th→TH, vn→VN, ph→PH, gb/uk→GB, in→IN, au→AU).",
                                },
                                "min_discount_pct": {
                                    "type": "number",
                                    "description": "Minimum discount percentage (default 10).",
                                    "default": 10,
                                    "minimum": 0,
                                    "maximum": 100,
                                },
                                "limit": {
                                    "type": "integer",
                                    "description": "Max results (default 10, max 50).",
                                    "default": 10,
                                    "minimum": 1,
                                    "maximum": 50,
                                },
                            },
                            "required": [],
                        },
                    ),
                    Tool(
                        name="list_categories",
                        description=(
                            "Browse available product categories. Returns the category taxonomy "
                            "and product counts."
                        ),
                        inputSchema={
                            "type": "object",
                            "properties": {
                                "country_code": {
                                    "type": "string",
                                    "description": "ISO country code (SG, US, MY, TH, VN, GB, IN, AU). Defaults to SG.",
                                },
                                "country": {
                                    "type": "string",
                                    "description": "Alias for country_code.",
                                },
                                "region": {
                                    "type": "string",
                                    "description": "Alias for country_code/market (us→US, sg→SG, my→MY, gb→GB, in→IN, au→AU).",
                                },
                            },
                            "required": [],
                        },
                    ),
                ]
            )

        @server.call_tool()
        async def call_tool(name: str, arguments: dict[str, Any]) -> CallToolResult:
            if name == "search_products":
                return await _handle_search_products(arguments)
            if name == "get_product":
                return await _handle_get_product(arguments)
            if name == "find_best_price":
                return await _handle_find_best_price(arguments)
            if name == "get_deals":
                return await _handle_get_deals(arguments)
            if name == "list_categories":
                return await _handle_list_categories(arguments)
            return CallToolResult(
                content=[TextContent(type="text", text=f"Unknown tool: {name}")],
                isError=True,
            )

        _api_server = server

    return _api_server


async def _handle_search_products(args: dict[str, Any]) -> CallToolResult:
    query = str(args.get("query", "")).strip()
    if not query:
        return CallToolResult(
            content=[TextContent(type="text", text="Error: query is required")],
            isError=True,
        )

    params = {"q": query, "limit": min(int(args.get("limit", 10)), 50)}
    for key in ("category", "min_price", "max_price", "source"):
        if args.get(key) is not None:
            params[key] = args[key]
    # country_code scopes the GIN scan to a single market (7.8M rows for SG vs 28M total).
    # BUY-70791: also accept `country` and `region` aliases (sg/us/my/...) so probes that
    # pass region:"sg" hit the SG partition instead of the global 28M-row catalog.
    country_code = _normalize_country_arg(args)
    if country_code:
        params["country_code"] = country_code

    try:
        data = await _api_get("/v1/search", params)
    except Exception as exc:
        logger.exception("search_products API error for %r", query)
        return CallToolResult(
            content=[TextContent(type="text", text=f"Search failed: {exc}")],
            isError=True,
        )

    items = data.get("items", []) if isinstance(data, dict) else []
    if not items:
        return CallToolResult(
            content=[TextContent(type="text", text=f"No products found for: {query}")]
        )

    lines = [f"Found {len(items)} product(s) for **{query}**:\n"]
    for i, p in enumerate(items, 1):
        lines.append(_fmt_product_summary(i, p))
    return CallToolResult(content=[TextContent(type="text", text="\n".join(lines))])


async def _handle_get_product(args: dict[str, Any]) -> CallToolResult:
    product_id = args.get("product_id")
    if not product_id:
        return CallToolResult(
            content=[TextContent(type="text", text="Error: product_id is required")],
            isError=True,
        )
    try:
        data = await _api_get(f"/v1/products/{product_id}")
    except Exception as exc:
        logger.exception("get_product API error for id %r", product_id)
        return CallToolResult(
            content=[TextContent(type="text", text=f"Fetch failed: {exc}")],
            isError=True,
        )
    return CallToolResult(content=[TextContent(type="text", text=_fmt_product_detail(data))])


async def _handle_find_best_price(args: dict[str, Any]) -> CallToolResult:
    product_name = str(args.get("product_name", "")).strip()
    if not product_name:
        product_name = str(args.get("q", "")).strip()
    if not product_name:
        return CallToolResult(
            content=[TextContent(type="text", text="Error: product_name is required")],
            isError=True,
        )
    params = {"q": product_name}
    if args.get("category"):
        params["category"] = args["category"]
    # BUY-70791: normalize country/country_code/region (with sg/us/my/... aliases)
    # so /v1/products/best-price hits the country partition instead of the 28M-row
    # global scan that produces 19-32s timeouts under DB IO saturation.
    country_code = _normalize_country_arg(args)
    if country_code:
        params["country_code"] = country_code

    try:
        p = await _api_get("/v1/products/best-price", params)
    except Exception as exc:
        logger.exception("find_best_price API error for %r", product_name)
        return CallToolResult(
            content=[TextContent(type="text", text=f"Search failed: {exc}")],
            isError=True,
        )

    if not p or not isinstance(p, dict):
        return CallToolResult(
            content=[TextContent(type="text", text=f"No products found for: {product_name}")]
        )

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
    return CallToolResult(content=[TextContent(type="text", text="\n".join(lines))])


async def _handle_get_deals(args: dict[str, Any]) -> CallToolResult:
    min_discount_pct = float(args.get("min_discount_pct", 10))
    limit = min(int(args.get("limit", 10)), 50)
    params = {"min_discount_pct": min_discount_pct, "limit": limit}
    if args.get("category"):
        params["category"] = args["category"]
    # BUY-70791: use the shared alias helper so behavior matches search_products/find_best_price.
    country_code = _normalize_country_arg(args)
    if country_code:
        params["country_code"] = country_code

    try:
        data = await _api_get("/v1/deals", params)
    except Exception as exc:
        logger.exception("get_deals API error")
        return CallToolResult(
            content=[TextContent(type="text", text=f"Deals fetch failed: {exc}")],
            isError=True,
        )

    items = data.get("items", []) if isinstance(data, dict) else []
    if not items:
        return CallToolResult(
            content=[TextContent(type="text", text=f"No deals found with >={min_discount_pct}% discount.")]
        )

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
    return CallToolResult(content=[TextContent(type="text", text="\n".join(lines))])




async def _handle_list_categories(args: dict[str, Any]) -> CallToolResult:
    # BUY-60069: propagate region/country_code so the upstream categories endpoint
    # can scope counts to the requested market instead of always defaulting to SG.
    REGION_TO_COUNTRY: dict[str, str] = {
        "sg": "SG",
        "us": "US",
        "my": "MY",
        "th": "TH",
        "vn": "VN",
        "gb": "GB",
        "uk": "GB",
        "in": "IN",
        "au": "AU",
        "sea": "SG",
    }

    def normalize_country(value: Any) -> str:
        raw = str(value or "").strip()
        if not raw:
            return ""
        return REGION_TO_COUNTRY.get(raw.lower()) or raw.upper()

    params: dict[str, Any] = {}
    country = normalize_country(
        args.get("country_code") or args.get("country") or args.get("region")
    ) or "SG"
    if country:
        params["country_code"] = country

    try:
        data = await _api_get("/v1/categories", params)
    except Exception as exc:
        logger.exception("list_categories API error")
        return CallToolResult(
            content=[TextContent(type="text", text=f"Categories fetch failed: {exc}")],
            isError=True,
        )

    categories = data.get("categories", []) if isinstance(data, dict) else []
    if not categories:
        return CallToolResult(
            content=[TextContent(type="text", text="No categories available.")]
        )

    lines = [f"Found {len(categories)} categories:\n"]
    for i, cat in enumerate(categories, 1):
        name = cat.get("name", "Unknown")
        count = cat.get("count", 0)
        slug = cat.get("slug", "")
        lines.append(f"{i}. **{name}** — {count} products (/{slug})")
    return CallToolResult(content=[TextContent(type="text", text="\n".join(lines))])
async def _api_get(path: str, params: dict[str, Any] | None = None) -> Any:
    import httpx
    from app.config import get_settings
    settings = get_settings()
    API_BASE_URL = settings.app_base_url or "http://localhost:8000"

    headers = {"Accept": "application/json"}
    # Forward the caller's Bearer token so internal routes can authenticate
    auth = _request_auth.get()
    if auth:
        headers["Authorization"] = auth
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


class JSONRPCRequest(BaseModel):
    jsonrpc: str = "2.0"
    method: str
    params: dict[str, Any] | None = None
    id: Any = None


class JSONRPCResponse(BaseModel):
    jsonrpc: str = "2.0"
    id: Any
    result: Any | None = None
    error: dict[str, Any] | None = None


@router.post("/v1/tools/list")
async def list_tools(request: Request, api_key: ApiKey = Depends(get_current_api_key)):
    server = get_mcp_server()
    result = await server.list_tools()
    return JSONRPCResponse(id="pending", result=result)


@router.post("/v1/tools/call")
async def call_tool(
    request: Request,
    body: JSONRPCRequest,
    api_key: ApiKey = Depends(get_current_api_key),
):
    server = get_mcp_server()
    # Thread the caller's Bearer token into the contextvar so _api_get can forward it
    auth_header = request.headers.get("Authorization", "")
    token = _request_auth.set(auth_header)
    try:
        result = await server.call_tool(body.method, body.params or {})
        return JSONRPCResponse(id=body.id, result=result)
    except Exception as exc:
        logger.exception("MCP tool call error: %s %s", body.method, exc)
        return JSONRPCResponse(
            id=body.id,
            error={"code": -32603, "message": str(exc)}
        )
    finally:
        _request_auth.reset(token)