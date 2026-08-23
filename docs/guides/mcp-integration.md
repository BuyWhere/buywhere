---
title: "MCP Integration"
description: "BuyWhere works natively with Claude Desktop, Cursor, Windsurf, and any Model Context Protocol (MCP)(https://modelcontextprotocol.io/) client. This guide…"
public: true
---

# AI Agent Integration via MCP

BuyWhere works natively with Claude Desktop, Cursor, Windsurf, and any [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) client. This guide shows you how to set it up.

## What You Get

Once connected, your AI agent has access to these tools:

| Tool | Version | Description |
|------|---------|-------------|
| `search_products` | v1 (legacy) | Keyword search with country, category, price, and brand filters |
| `search_products_v2` | **v2 (recommended)** | Keyword search with **required** `deliver_to` parameter |
| `get_product` | v1 (legacy) | Fetch full product details by UUID |
| `get_product_v2` | **v2 (recommended)** | Fetch full product details with **required** `deliver_to` |
| `compare_products` | v1 (legacy) | Side-by-side comparison of 2–10 products |
| `compare_products_v2` | **v2 (recommended)** | Compare products with **required** `deliver_to` |
| `get_deals` | v1 (legacy) | Find discounted products |
| `get_deals_v2` | **v2 (recommended)** | Find deals with **required** `deliver_to` |
| `list_categories` | v1 | Browse the product category taxonomy |
| `find_best_price` | v1 (legacy) | Locate the cheapest option across all merchants |
| `find_best_price_v2` | **v2 (recommended)** | Find best price with **required** `deliver_to` |

### About `deliver_to`

The v2 tools require a `deliver_to` parameter — the buyer's delivery destination as an ISO 3166-1 alpha-2 country code (e.g., `"SG"`, `"US"`, `"MY"`).

**Why it matters:**
- Filters out products that cannot be shipped to the buyer's location
- Improves relevance by ranking deliverable products higher
- Prevents wasted agent cycles on unshippable items

**Migration from v1:**
- Add `deliver_to` to your tool calls (required on v2)
- Example: `search_products_v2(q="laptop", deliver_to="SG")`
- v1 tools remain available but lack deliverable filtering

## Setup: Claude Desktop

1. Get a BuyWhere API key at [buywhere.ai/api-keys](https://buywhere.ai/api-keys)

2. Open your Claude Desktop config file:
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

3. Add the BuyWhere MCP server:

```json
{
  "mcpServers": {
    "buywhere": {
      "command": "npx",
      "args": ["-y", "@buywhere/mcp-server"],
      "env": {
        "BUYWHERE_API_KEY": "bw_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

4. Restart Claude Desktop.

## Setup: Cursor

Add to your Cursor MCP settings (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "buywhere": {
      "command": "npx",
      "args": ["-y", "@buywhere/mcp-server"],
      "env": {
        "BUYWHERE_API_KEY": "bw_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

## Setup: Claude Code

Add to your Claude Code MCP settings:

```json
{
  "mcpServers": {
    "buywhere": {
      "command": "npx",
      "args": ["-y", "@buywhere/mcp-server"],
      "env": {
        "BUYWHERE_API_KEY": "bw_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

## Try It

Once connected, ask your AI agent:

> "Find me the cheapest wireless headphones in Singapore under $200"

> "Compare the Sony WH-1000XM5 with the Bose QuietComfort Ultra"

> "What are the best electronics deals right now?"

> "Track the price history for this laptop over the last 30 days"

The agent will automatically use BuyWhere's tools to search products, compare prices, and find deals.

## Using the TypeScript SDK

For programmatic agent integrations, use the TypeScript SDK:

```bash
npm install @buywhere/sdk
```

```typescript

const client = new BuyWhereClient({
  apiKey: process.env.BUYWHERE_API_KEY,
});

const results = await client.search.search({
  q: "mechanical keyboard",
  country_code: "SG",
  limit: 5,
});

console.log(results.products);
```

## Using the LangChain Integration

```bash
npm install @buywhere/buywhere-langchain
```

```typescript

const tools = new BuyWhereTools({
  apiKey: process.env.BUYWHERE_API_KEY,
});

// Use with any LangChain agent
const agent = createAgent({
  tools: tools.getTools(),
  // ...
});
```

## OpenAI Function Calling

Use the OpenAPI spec directly for OpenAI function calling:

```
GET https://api.buywhere.ai/openapi.json
```

A ChatGPT Actions-compatible version is available at:

```
GET https://api.buywhere.ai/chatgpt-openapi.json
```

## Discovery Endpoints

BuyWhere exposes standard discovery endpoints for AI agent platforms:

| Endpoint | Purpose |
|----------|---------|
| `/.well-known/ai-plugin.json` | OpenAI plugin manifest |
| `/.well-known/mcp.json` | MCP server manifest |
| `/.well-known/glama.json` | Glama.ai agent discovery |
| `/openapi.json` | OpenAPI 3.1 spec |
| `/chatgpt-openapi.json` | ChatGPT Actions spec |
| `/llms.txt` | LLM-readable service description |

## Next Steps

- [Getting Started](/docs/getting-started) — get your API key and make your first call
- [API Reference](/docs/api-reference/search) — full endpoint documentation
- [Build a Price Comparison Tool](/docs/guides/price-comparison) — Python quickstart
