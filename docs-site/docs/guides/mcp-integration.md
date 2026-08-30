---
sidebar_position: 2
title: "MCP Integration"
---

# AI Agent Integration via MCP

BuyWhere works natively with Claude Desktop, Cursor, Windsurf, and any [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) client. This guide shows you how to set it up.

## What You Get

Once connected, your AI agent has access to these tools:

| Tool | Description |
|------|-------------|
| `search_products` | Keyword search with country, category, price, and brand filters |
| `get_product` | Fetch full product details by UUID |
| `compare_products` | Side-by-side comparison of 2–10 products |
| `get_deals` | Find discounted products |
| `list_categories` | Browse the product category taxonomy |
| `find_best_price` | Locate the cheapest option across all merchants |

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
import { BuyWhereClient } from "@buywhere/sdk";

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
import { BuyWhereTools } from "@buywhere/buywhere-langchain";

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

- [Getting Started](/) — get your API key and make your first call
- [API Reference](/docs/api-reference/search) — full endpoint documentation
- [Build a Price Comparison Tool](/docs/guides/price-comparison) — Python quickstart
