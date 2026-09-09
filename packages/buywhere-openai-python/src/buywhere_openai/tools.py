from __future__ import annotations

from typing import Any

BuyWhereTools: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "search_products",
            "description": (
                "Search the BuyWhere product catalog by keyword, price range, platform, "
                "region, and country. Returns product listings with prices, merchant info, "
                "and availability."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "q": {
                        "type": "string",
                        "description": 'Keyword search query (e.g. "wireless headphones")',
                    },
                    "country_code": {
                        "type": "string",
                        "enum": ["SG", "US", "VN", "TH", "MY", "ID", "PH"],
                        "description": "ISO country code (default: SG)",
                    },
                    "domain": {
                        "type": "string",
                        "description": "Filter by merchant platform (e.g. lazada, shopee)",
                    },
                    "min_price": {
                        "type": "number",
                        "description": "Minimum price in the active currency",
                    },
                    "max_price": {
                        "type": "number",
                        "description": "Maximum price in the active currency",
                    },
                    "currency": {
                        "type": "string",
                        "default": "SGD",
                        "description": "Currency for price filters",
                    },
                    "limit": {
                        "type": "integer",
                        "default": 20,
                        "maximum": 100,
                        "description": "Maximum results to return",
                    },
                    "offset": {
                        "type": "integer",
                        "default": 0,
                        "description": "Offset for pagination",
                    },
                },
                "required": ["q"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_product",
            "description": (
                "Get full product details and current price by product ID. Includes brand, "
                "category, ratings, merchant info, and specifications."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {
                        "type": "string",
                        "description": "The unique product ID",
                    },
                    "currency": {
                        "type": "string",
                        "default": "SGD",
                        "description": "Currency for price display",
                    },
                },
                "required": ["id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compare_products",
            "description": (
                "Compare 2-10 products side-by-side across merchants: price, brand, rating, "
                "category path, and merchant. For AI agent price comparison shopping."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "ids": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 2,
                        "maxItems": 10,
                        "description": "Product IDs to compare (2-10)",
                    },
                },
                "required": ["ids"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_deals",
            "description": (
                "Get discounted products sorted by discount percentage across all merchants. "
                "Returns original price, current price, and discount percentage."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "country_code": {
                        "type": "string",
                        "enum": ["SG", "US", "VN", "TH", "MY", "ID", "PH"],
                        "description": "ISO country code",
                    },
                    "min_discount": {
                        "type": "number",
                        "default": 10,
                        "description": "Minimum discount percentage (0-90)",
                    },
                    "currency": {
                        "type": "string",
                        "default": "SGD",
                        "description": "Currency for price display",
                    },
                    "limit": {
                        "type": "integer",
                        "default": 20,
                        "maximum": 100,
                        "description": "Maximum deals to return",
                    },
                    "offset": {
                        "type": "integer",
                        "default": 0,
                        "description": "Offset for pagination",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_categories",
            "description": (
                "List top-level product categories available in the BuyWhere catalog with "
                "slugs, names, and product counts."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "currency": {
                        "type": "string",
                        "default": "SGD",
                        "description": "Currency for product counts",
                    },
                },
            },
        },
    },
]

from typing import Literal

BuyWhereToolName = Literal[
    "search_products",
    "get_product",
    "compare_products",
    "get_deals",
    "list_categories",
]

def BuyWhereTools_as_functions() -> list[dict[str, Any]]:
    """Return tools in the legacy Chat Completions `functions` format.

    Each tool is converted from the `tools` format (with `type: "function"`)
    to the legacy `functions` format where only the `.function` payload is returned.
    """
    return [t["function"] for t in BuyWhereTools]


__all__ = ["BuyWhereTools", "BuyWhereToolName", "BuyWhereTools_as_functions"]
