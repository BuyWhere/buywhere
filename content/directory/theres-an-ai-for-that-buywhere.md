---
title: "BuyWhere - AI Agent for Shopping Price Comparison"
slug: "buywhere-ai-agent-shopping-price-comparison"
description: "BuyWhere is an AI agent and API for comparing product prices across major US and Singapore retailers including Amazon, Best Buy, Walmart, Target, Shopee, and Lazada. Find the cheapest prices, track price changes, and build shopping agents with the BuyWhere MCP server."
category: "Shopping & E-Commerce"
tags:
  - "price comparison"
  - "shopping agent"
  - "product search"
  - "MCP server"
  - "price tracking"
  - "e-commerce API"
  - "Amazon"
  - "Best Buy"
  - "Walmart"
  - "Shopee"
  - "Lazada"
  - "deal discovery"
  - "Singapore"
  - "United States"
published: true
featured: true
---

# BuyWhere — AI Agent for Shopping Price Comparison

## Overview

BuyWhere is an AI-native product price comparison API and MCP server that helps developers build shopping agents, price tracking tools, and deal discovery applications. The platform covers major US retailers (Amazon, Best Buy, Walmart, Target, Costco, Newegg, B&H Photo) and Singapore retailers (Shopee, Lazada, Courteney), with support for 120,000+ products across 7 platforms.

## Use Cases

- **AI Shopping Agents**: Embed real-time product search and price comparison into AI agents using the MCP protocol
- **Price Comparison Tools**: Build dashboards that compare prices across multiple retailers in real time
- **Deal Discovery**: Surface the best prices and discount windows for any product category
- **Price Alert Systems**: Monitor price changes and notify users when deals drop below target thresholds
- **Affiliate Shopping Pages**: Create monetized shopping pages with live merchant links and price data

## Platform Coverage

| Region | Retailers | Products | Currency |
|--------|-----------|----------|----------|
| United States | Amazon, Best Buy, Walmart, Target, Costco, Newegg, B&H Photo | 120,000+ | USD |
| Singapore | Shopee, Lazada, Courteney | 100,000+ | SGD |

## API Capabilities

### REST API
- `GET /v1/products/search` — Search products across all supported retailers
- `GET /v1/products/{id}` — Get product details with merchant availability
- `GET /v1/merchants` — List supported merchants by country
- `GET /v1/categories` — Browse product categories
- `GET /v1/price-history/{id}` — Historical price data for price trend analysis

### MCP Server Tools
- `search_products` — Full-text product search with filters for keyword, merchant, price, category, country, currency
- `get_product` — Get full product details by BuyWhere product ID
- `compare_products` — Compare 2–10 products side-by-side across merchants
- `get_deals` — Find discounted products sorted by discount percentage
- `list_categories` — List top-level product categories with product counts
- `find_best_price` — Find the cheapest current listing for a product across all merchants

### Authentication
- API key authentication via `X-API-Key` header
- MCP server authentication via API key in server configuration

## Pricing

- **Free tier**: 1,000 API calls/month — no credit card required
- **Starter tier**: $9/month — 50,000 API calls/month
- **Pro tier**: $49/month — 500,000 API calls/month
- **Enterprise**: Custom limits and dedicated infrastructure

## Quick Start

```bash
# Install via npx
npx -y @buywhere/mcp-server

# Or use hosted MCP endpoint
# https://api.buywhere.ai/mcp
```

```typescript
import { McpServer } from "@buywhere/mcp-server";

const server = new McpServer({
  apiKey: process.env.BUYWHERE_API_KEY,
});

await server.connect();
```

## Integration Examples

### Claude Desktop
```json
{
  "mcpServers": {
    "buywhere": {
      "command": "npx",
      "args": ["-y", "@buywhere/mcp-server"],
      "env": {
        "BUYWHERE_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Cursor
Add to Cursor settings → MCP Servers.

## Comparison with Similar Tools

| Feature | BuyWhere | Honey | CamelCamelCamel | Keepa |
|---------|----------|-------|-----------------|-------|
| Multi-retailer (US + SG) | Yes | Partial | Yes | Yes |
| MCP server | Yes | No | No | No |
| Real-time API | Yes | No | Yes | Yes |
| Singapore support | Yes | No | No | No |
| AI agent native | Yes | No | No | No |
| Free tier | Yes | Yes | Yes | Limited |

## Related Tools

- [BuyWhere API Reference](/pages/api-reference)
- [BuyWhere MCP Developer FAQ](/compare/buywhere-mcp-developer-faq)
- [BuyWhere vs Smithery Alternatives](/compare/buywhere-vs-smithery-alternatives)
- [BuyWhere Developer Documentation](/developers)
