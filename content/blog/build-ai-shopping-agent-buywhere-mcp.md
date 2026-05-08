---
title: "How to Build an AI Shopping Agent with BuyWhere MCP Server"
slug: "build-ai-shopping-agent-buywhere-mcp"
description: "Step-by-step guide to building an AI shopping agent using the BuyWhere MCP server. Covers connecting BuyWhere to Claude Desktop, Cursor, and other MCP clients, product search, price comparison, deal discovery, and handling natural language shopping queries."
category: Blog
tags:
  - "AI shopping agent tutorial"
  - "BuyWhere MCP server guide"
  - "Claude shopping agent"
  - "MCP server tutorial"
  - "AI agent product search"
  - "shopping agent development"
  - "Cursor AI shopping"
  - "price comparison AI agent"
schema_type: Article
published: true
updated: 2026-05-08
---

# How to Build an AI Shopping Agent with BuyWhere MCP Server

AI agents can now help users shop — answering natural language queries like "find me the cheapest MacBook Pro in Singapore" or "which retailer has the Nintendo Switch on sale right now." Building this capability requires a product data API and a tool framework that lets the agent query it naturally. The BuyWhere MCP server provides both.

This guide walks through building an AI shopping agent using the BuyWhere MCP server with Claude Desktop, Cursor, or any MCP-compatible client.

---

## What is an MCP Server?

The Model Context Protocol (MCP) is an open standard for connecting AI models to external tools and data sources. An MCP server exposes your API as a set of tools that an AI agent can call directly — without API key management or custom code on the agent side.

BuyWhere's MCP server exposes product search, price comparison, and deal discovery as native tools.

---

## Prerequisites

- [Claude Desktop](https://claude.ai/download) (or Cursor, Windsurf, or any MCP client)
- A BuyWhere API key ([get one free](https://buywhere.ai/api-keys))
- Node.js 18+ (for local MCP server)

---

## 1. Set Up the BuyWhere MCP Server

**Option A: Use the hosted MCP server (recommended for Claude Desktop)**

Add BuyWhere to your Claude Desktop MCP settings:

```json
{
  "mcpServers": {
    "buywhere": {
      "command": "npx",
      "args": ["-y", "@buywhere/mcp-server"]
    }
  }
}
```

Configure your API key as an environment variable:

```bash
export BUYWHERE_API_KEY=your_api_key_here
```

**Option B: Run locally**

```bash
npm install -g @buywhere/mcp-server
buywhere-mcp-server
```

---

## 2. Test the Connection

In Claude Desktop, try asking:

> "Search for Sony WH-1000XM5 headphones in the US and show me the cheapest price."

The agent will call the BuyWhere product search tool and return a structured response.

---

## 3. Core Shopping Agent Capabilities

### 3.1 Product Search

The agent can search for products across all supported retailers:

> "Find me the best price for a Dyson V15 vacuum cleaner in Singapore."

```javascript
// The MCP tool call
{
  tool: "buywhere_products_search",
  arguments: {
    query: "Dyson V15 vacuum cleaner",
    country: "SG",
    limit: 5
  }
}
```

### 3.2 Cross-Retailer Price Comparison

The agent automatically compares prices across merchants:

> "Compare prices for the iPhone 15 Pro across Amazon, Walmart, and Shopee in the US."

```javascript
{
  tool: "buywhere_products_search",
  arguments: {
    query: "iPhone 15 Pro 256GB",
    country: "US",
    limit: 10
  }
}
```

The agent then sorts and presents the results ranked by price.

### 3.3 Deal Discovery

Find products with active discounts:

> "Show me the best tech deals with at least 15% off right now."

```javascript
{
  tool: "buywhere_products_search",
  arguments: {
    category: "electronics",
    country: "US",
    min_discount: 15,
    limit: 20
  }
}
```

### 3.4 Multi-Country Price Comparison

Compare prices across regions:

> "Is the MacBook Air M3 cheaper in Singapore or the US right now?"

```javascript
{
  tool: "buywhere_products_search",
  arguments: [
    { query: "MacBook Air M3", country: "SG", limit: 3 },
    { query: "MacBook Air M3", country: "US", limit: 3 }
  ]
}
```

---

## 4. Building a Custom Agent

For more control, build a custom agent using the BuyWhere SDK:

```javascript
import { BuyWhere } from '@buywhere/sdk';
import { Anthropic } from '@anthropic-ai/sdk';

const client = new BuyWhere({ apiKey: process.env.BUYWHERE_API_KEY });
const anthropic = new Anthropic();

async function shoppingAgent(userMessage) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `You are a shopping assistant. Use the BuyWhere API to answer questions about product prices and deals.

User question: ${userMessage}

To search for products, use the buywhere.products.search() function.
To compare prices, call search and sort results by price.`,
      },
    ],
    tools: [
      {
        name: 'buywhere_products_search',
        description: 'Search for products across BuyWhere retailers',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Product search query' },
            country: {
              type: 'string',
              enum: ['US', 'SG', 'MY', 'TH', 'VN', 'PH', 'ID'],
            },
            limit: { type: 'number', default: 10 },
            min_discount: { type: 'number', description: 'Minimum discount percentage' },
          },
          required: ['query', 'country'],
        },
      },
    ],
  });

  return response;
}
```

---

## 5. Handling Natural Language Responses

The agent should present price comparisons in a clear, structured format:

```
I found 5 results for "Sony WH-1000XM5 headphones" in the US:

1. Amazon — $349.99 ⭐ 4.8 — In stock
2. Walmart — $379.99 ⭐ 4.8 — In stock
3. Best Buy — $399.99 ⭐ 4.7 — In stock
4. Target — $379.99 ⭐ 4.8 — Limited stock
5. B&H Photo — $369.99 ⭐ 4.7 — In stock

💰 Best price: Amazon at $349.99
```

---

## 6. Adding Price Drop Alerts

Extend the agent to track prices and alert when they drop:

```javascript
async function trackPrice(agent, productQuery, targetPrice, country) {
  const results = await client.products.search({
    query: productQuery,
    country,
    limit: 5,
  });

  const cheapest = results.products.sort((a, b) => a.price - b.price)[0];

  if (cheapest.price <= targetPrice) {
    await agent.sendMessage(
      `Price alert! ${cheapest.name} is now $${cheapest.price} at ${cheapest.domain} ` +
      `(target was $${targetPrice})`
    );
  }
}
```

---

## 7. Extending to Multi-Category Shopping

The agent can handle any product category:

```javascript
const categoryHandlers = {
  electronics: handleElectronics,
  fashion: handleFashion,
  home: handleHomeGoods,
  sports: handleSportsEquipment,
};

async function routeQuery(query, category) {
  const handler = categoryHandlers[category] || handleGeneralSearch;
  return handler(query);
}
```

---

## 8. Production Considerations

- **Rate limiting**: The BuyWhere free tier allows 1,000 calls/month. Cache results to reduce API calls.
- **Freshness**: Product prices update in real-time. Display the last-checked timestamp.
- **Stock status**: Always filter or flag out-of-stock items — a low price is useless if the product is unavailable.
- **Multi-country**: Prices vary by region. Prompt users to confirm their country.

---

## Get Started

- [Get API key](https://buywhere.ai/api-keys) — free tier, no credit card
- [MCP setup guide](https://buywhere.ai/integrate) — connect to Claude, Cursor, or any MCP client
- [API docs](https://api.buywhere.ai/docs)
- [npm package](https://www.npmjs.com/package/@buywhere/mcp-server)

---

## Related Guides

- [Build a Price Comparison Tool with BuyWhere API](/blog/build-price-comparison-tool-buywhere-api) — Build a traditional price comparison app
- [Best Price Tracking Tools Singapore](/blog/best-price-tracking-tools-singapore) — Tools to monitor prices across retailers
- [BuyWhere vs Attentive](/compare/buywhere-vs-attentive) — Compare BuyWhere and Attentive for commerce use cases