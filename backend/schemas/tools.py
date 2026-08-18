"""Canonical tool schemas for AI agent integrations.

Defines BuyWhere tools in OpenAI function-calling format and MCP tool format.
Published at /tools/openai.json and /tools/mcp.json for agent discovery.
"""

OPENAI_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "resolve_product_query",
            "description": "Search the BuyWhere product catalog by natural language query. Returns ranked products with prices, ratings, availability, and affiliate links. Best for: product discovery, finding specific items, exploring categories.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Natural language search query (e.g., 'wireless headphones under 100 SGD', 'Nike running shoes men')"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum results to return (1-100, default 10)",
                        "minimum": 1,
                        "maximum": 100,
                        "default": 10
                    },
                    "offset": {
                        "type": "integer",
                        "description": "Pagination offset",
                        "minimum": 0,
                        "default": 0
                    },
                    "source": {
                        "type": "string",
                        "description": "Filter by source platform (e.g., 'shopee_sg', 'lazada_sg', 'amazon_sg')"
                    },
                    "min_price": {
                        "type": "number",
                        "description": "Minimum price filter"
                    },
                    "max_price": {
                        "type": "number",
                        "description": "Maximum price filter"
                    },
                    "availability": {
                        "type": "boolean",
                        "description": "Filter by availability (true = in stock only)"
                    },
                    "sort_by": {
                        "type": "string",
                        "enum": ["relevance", "price_asc", "price_desc", "newest"],
                        "description": "Sort order (default: relevance)"
                    }
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "find_best_price",
            "description": "Find the single cheapest listing for a product across all Singapore e-commerce platforms. Returns the platform, price, and affiliate URL for the lowest available price. Best for: finding the best deal, price-sensitive purchases.",
            "parameters": {
                "type": "object",
                "properties": {
                    "product_name": {
                        "type": "string",
                        "description": "Product name or search query to find the best price for"
                    },
                    "category": {
                        "type": "string",
                        "description": "Optional category to narrow the search"
                    }
                },
                "required": ["product_name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "compare_products",
            "description": "Side-by-side price comparison of a product across multiple platforms. Returns a matrix with prices, savings calculations, availability, and ratings. Best for: informed purchasing decisions, cross-platform research.",
            "parameters": {
                "type": "object",
                "properties": {
                    "product_name": {
                        "type": "string",
                        "description": "Product name to compare prices for"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum results per platform (1-50, default 10)",
                        "minimum": 1,
                        "maximum": 50,
                        "default": 10
                    },
                    "sources": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Specific sources to compare (e.g., ['shopee_sg', 'lazada_sg']). If omitted, compares all available sources."
                    },
                    "availability_only": {
                        "type": "boolean",
                        "description": "Only show products that are in stock",
                        "default": False
                    },
                    "sort_by": {
                        "type": "string",
                        "enum": ["price_asc", "price_desc", "relevance", "newest"],
                        "description": "Sort order (default: price_asc)",
                        "default": "price_asc"
                    }
                },
                "required": ["product_name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_product_details",
            "description": "Get full details for a specific product by its BuyWhere ID. Returns price, specs, rating, reviews, stock level, and buy/affiliate URLs. Best for: product research, checking specific item details.",
            "parameters": {
                "type": "object",
                "properties": {
                    "product_id": {
                        "type": "integer",
                        "description": "The BuyWhere product ID"
                    },
                    "include_metadata": {
                        "type": "boolean",
                        "description": "Include additional metadata (brand, specifications)",
                        "default": False
                    },
                    "affiliate_links": {
                        "type": "boolean",
                        "description": "Include affiliate tracking links",
                        "default": True
                    }
                },
                "required": ["product_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_purchase_options",
            "description": "Get all purchase options for a product across different retailers. Returns affiliate links, prices from different sources, and availability. Best for: generating purchase links, finding where to buy.",
            "parameters": {
                "type": "object",
                "properties": {
                    "product_id": {
                        "type": "integer",
                        "description": "The BuyWhere product ID"
                    },
                    "include_alternatives": {
                        "type": "boolean",
                        "description": "Include similar products from other retailers",
                        "default": False
                    }
                },
                "required": ["product_id"]
            }
        }
    }
]

MCP_TOOLS = [
    {
        "name": "search_products",
        "description": "Search the BuyWhere product catalog by keyword. Returns ranked results from Singapore e-commerce platforms (Lazada, Shopee, Qoo10, Carousell).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Product search query."},
                "category": {"type": "string", "description": "Optional category filter."},
                "min_price": {"type": "number", "description": "Minimum price in SGD."},
                "max_price": {"type": "number", "description": "Maximum price in SGD."},
                "source": {"type": "string", "description": "Platform filter (lazada_sg, shopee_sg, etc.)."},
                "limit": {"type": "integer", "description": "Max results (default 10, max 50).", "default": 10, "minimum": 1, "maximum": 50}
            },
            "required": ["query"]
        }
    },
    {
        "name": "get_product",
        "description": "Retrieve full details for a specific product by its BuyWhere ID.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "product_id": {"type": "integer", "description": "The BuyWhere product ID."}
            },
            "required": ["product_id"]
        }
    },
    {
        "name": "find_best_price",
        "description": "Find the single cheapest listing for a product across all Singapore e-commerce platforms. Returns the platform, price, and affiliate URL for the lowest available price.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "product_name": {"type": "string", "description": "Product name or search query."},
                "category": {"type": "string", "description": "Optional category to narrow the search."}
            },
            "required": ["product_name"]
        }
    },
    {
        "name": "get_deals",
        "description": "Find products with significant price drops compared to their original price. Returns deals sorted by discount percentage with current price, original price, and savings.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "category": {"type": "string", "description": "Optional category filter (e.g. 'electronics')."},
                "min_discount_pct": {"type": "number", "description": "Minimum discount percentage (default 10).", "default": 10, "minimum": 0, "maximum": 100},
                "limit": {"type": "integer", "description": "Max results (default 10, max 50).", "default": 10, "minimum": 1, "maximum": 50}
            },
            "required": []
        }
    },
    {
        "name": "list_categories",
        "description": "Browse available product categories. Returns the category taxonomy and product counts.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "parent_id": {"type": "integer", "description": "Parent category ID to get subcategories."}
            },
            "required": []
        }
    }
]

TOOL_SCHEMAS = {
    "openai": OPENAI_TOOLS,
    "mcp": MCP_TOOLS
}