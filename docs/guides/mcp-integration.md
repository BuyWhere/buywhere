---
title: "MCP Integration"
description: "BuyWhere works natively with Claude Desktop, Cursor, Windsurf, and any Model Context Protocol (MCP)(https://modelcontextprotocol.io/) client. This guide shows you how to set it up and migrate to v2 tools for full buyer-market support."
public: true
lastUpdated: "2026-08-23"
---

# AI Agent Integration via MCP

BuyWhere works natively with Claude Desktop, Cursor, Windsurf, and any [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) client. This guide shows you how to set it up.

## Available Tools

The BuyWhere MCP server exposes 13 tools (8 v1, 5 v2):

| Tool | Description |
|------|-------------|
| `search_products` | Keyword search with country, category, price, and brand filters |
| `get_product` | Fetch full product details by UUID |
| `compare_products` | Side-by-side comparison of 2–10 products |
| `get_deals` | Find discounted products |
| `list_categories` | Browse the product category taxonomy |
| `find_best_price` | Locate the cheapest option across all merchants |
| `search_products_v2` | **REQUIRED `deliver_to`**. Full-text + semantic search with buyer-market ranking |
| `get_product_v2` | **REQUIRED `deliver_to`**. Product details with resolved click-tracker URL |
| `compare_products_v2` | **REQUIRED `deliver_to`**. Side-by-side comparison for buyer market |
| `get_deals_v2` | **REQUIRED `deliver_to`**. Discounted products scoped to buyer market |
| `find_best_price_v2` | **REQUIRED `deliver_to`**. Best price with shopping session ID for multi-merchant handoff |

## The `deliver_to` Parameter

**Every v2 tool requires `deliver_to`.** It is the buyer's ISO 3166-1 alpha-2 country code (uppercase).

```
deliver_to: "SG" | "US" | "MY" | "TH" | "VN" | "PH" | "ID" | "GB" | ...
```

### Why `deliver_to` matters

- **Filters undeliverable products** — results that cannot ship to the buyer are excluded
- **Ranks local-first** — products from merchants in the buyer's country appear first
- **Adds availability labels** — each result carries `availability: "local" | "ships_to_you" | "unavailable" | "unknown"` backed by verified shipping policies for 28,000+ stores
- **Prevents all-market scans** — without it, results span all countries and may be undeliverable

Always pass the end user's country, not the product's origin country.

## Migrating from v1 to v2

v1 tools are deprecated and will stop accepting calls on 2026-12-31Z. Migrating takes two changes:

### 1. Rename the tool

| v1 | v2 |
|----|----|
| `search_products` | `search_products_v2` |
| `get_product` | `get_product_v2` |
| `compare_products` | `compare_products_v2` |
| `get_deals` | `get_deals_v2` |
| `find_best_price` | `find_best_price_v2` |

### 2. Add `deliver_to`

Add `deliver_to` to every v2 tool call with the buyer's country:

```json
// v1 call
{
  "name": "search_products",
  "arguments": { "q": "wireless headphones", "country_code": "SG" }
}

// v2 call — add deliver_to
{
  "name": "search_products_v2",
  "arguments": { "q": "wireless headphones", "deliver_to": "SG" }
}
```

```json
// v1 call
{
  "name": "find_best_price",
  "arguments": { "q": "iphone 15 pro" }
}

// v2 call — add deliver_to, get shopping_job_id for multi-merchant handoff
{
  "name": "find_best_price_v2",
  "arguments": { "q": "iphone 15 pro", "deliver_to": "SG" }
}
```

> **Note:** In v2 tools, `deliver_to` takes precedence over `country_code`/`country` and determines buyer-market ranking and availability labels. You can omit `country_code` in v2 calls — `deliver_to` is the canonical market parameter.

## Setup: Claude Desktop

1. Get a BuyWhere API key at [buywhere.ai/api-keys](https://buywhere.ai/api-keys) — or let your agent self-register in one call (no email, no human): `curl -X POST "https://api.buywhere.ai/v1/auth/register?verify=false" -H "Content-Type: application/json" -d '{"agent_name":"my-agent"}'`

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

The agent will automatically use BuyWhere v2 tools with `deliver_to` to search products, compare prices, and find deals for your buyer market.

## Using the TypeScript SDK

For programmatic agent integrations, use the TypeScript SDK:

```bash
npm install @buywhere/sdk
```

```typescript
import { BuyWhereClient } from '@buywhere/sdk';

const client = new BuyWhereClient({
  apiKey: process.env.BUYWHERE_API_KEY,
});

// v2: always pass deliver_to
const results = await client.search.search({
  q: 'mechanical keyboard',
  deliver_to: 'SG', // REQUIRED in v2
  limit: 5,
});

console.log(results.products);
```

## Using the LangChain Integration

```bash
npm install @buywhere/buywhere-langchain
```

```typescript
import { BuyWhereTools } from '@buywhere/buywhere-langchain';

const tools = new BuyWhereTools({
  apiKey: process.env.BUYWHERE_API_KEY,
});

// Tools are v2 by default — deliver_to is passed per-call
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
