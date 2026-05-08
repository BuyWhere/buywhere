---
title: "BuyWhere — Product Price Comparison API and MCP Server"
slug: "github-marketplace-buywhere"
description: "BuyWhere is a product price comparison API and MCP server for AI agents. Compare prices across 500+ retailers including Amazon, Walmart, Shopee, and Lazada. Free tier available."
category: "Developer Tools"
subcategory: "Shopping & E-Commerce"
tags:
  - "price comparison"
  - "shopping agent"
  - "product search API"
  - "MCP server"
  - "price tracking"
  - "deal discovery"
  - "AI agent"
  - "e-commerce"
  - "API"
  - "product data"
  - "GitHub Marketplace"
published: true
featured: true
website: "https://buywhere.ai"
pricing: "Freemium"
api_available: true
mcp_server: true
open_source: false
---

# BuyWhere — Product Price Comparison API and MCP Server

## About

BuyWhere is an AI-native product price comparison API and MCP server that enables developers to build shopping agents, price tracking tools, and deal discovery applications. Compare prices across 500+ retailers including Amazon, Walmart, Best Buy, Target, Shopee, and Lazada.

## Key Features

### Multi-Platform Coverage
- **US Retailers**: Amazon, Best Buy, Walmart, Target, Costco, Newegg, B&H Photo
- **Southeast Asia**: Shopee, Lazada (Singapore, Malaysia, Thailand, Vietnam, Philippines, Indonesia)
- **500+ retailers** in USD, SGD, MYR, THB, VND, PHP, IDR

### MCP Server for AI Agents
BuyWhere provides an MCP (Model Context Protocol) server — AI agents like Claude, Cursor, and other MCP-compatible assistants can use it directly.

**Available MCP Tools:**
- `search_products` — Full-text product search with filters
- `get_product` — Product details by ID
- `compare_products` — Cross-merchant comparison
- `get_deals` — Discounted products
- `find_best_price` — Cheapest listing finder
- `list_categories` — Category browsing

### Developer API
RESTful API with comprehensive documentation — product search, real-time price comparison, price history, and merchant lookup.

## Quick Start

```bash
# Install MCP server
npx -y @buywhere/mcp-server
```

```json
// Claude Desktop configuration
{
  "mcpServers": {
    "buywhere": {
      "command": "npx",
      "args": ["-y", "@buywhere/mcp-server"]
    }
  }
}
```

## Pricing

| Plan | Monthly Price | API Calls |
|------|--------------|-----------|
| Free | $0 | 1,000/month |
| Starter | $9 | 50,000/month |
| Pro | $49 | 500,000/month |
| Enterprise | Custom | Unlimited |

## Use Cases

- AI shopping assistants and agents
- Price comparison websites
- Deal alert applications
- Affiliate shopping tools
- Market research and analytics

## Links

- [Website](https://buywhere.ai)
- [API Docs](https://api.buywhere.ai/docs)
- [Get API Key](https://buywhere.ai/api-keys)
- [MCP Setup Guide](https://buywhere.ai/integrate)
- [npm Package](https://www.npmjs.com/package/@buywhere/mcp-server)