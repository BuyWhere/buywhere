---
title: "BuyWhere — API for Real-Time Product Price Comparison"
slug: "api-listings-buywhere"
description: "BuyWhere is a product price comparison API with MCP server support. Compare prices across Amazon, Best Buy, Walmart, Shopee, Lazada and 500+ retailers. Free tier includes 1,000 API calls/month."
category: "API Marketplace"
tags:
  - "price comparison API"
  - "product search API"
  - "shopping API"
  - "MCP server"
  - "e-commerce API"
  - "price tracking API"
  - "product data API"
  - "affiliate API"
published: true
---

# BuyWhere — API for Real-Time Product Price Comparison

## API Description

BuyWhere is a product price comparison API that aggregates pricing data from 500+ retailers in the US and Singapore. The API returns live prices, merchant ratings, stock availability, and price history data. An MCP server is available for AI agent integration.

## API Characteristics

| Attribute | Value |
|-----------|-------|
| **Protocol** | REST + MCP (Model Context Protocol) |
| **Authentication** | API Key (X-API-Key header) |
| **Data freshness** | Real-time |
| **Rate limits** | 1,000–500,000 calls/month depending on plan |
| **Coverage** | US (Amazon, Best Buy, Walmart, Target, Costco, Newegg, B&H Photo) + SG (Shopee, Lazada, Courteney) |
| **Products indexed** | 120,000+ |
| **Uptime** | 99.9% SLA for Business+ |

## Core Endpoints

### Product Search
```
GET /v1/products/search?q={query}&country={us|sg}&category={category}&limit={1-50}
```

### Price Comparison
```
GET /v1/compare-prices?product_id={id}&country={us|sg}
```

### Price History
```
GET /v1/price-history/{product_id}?country={us|sg}&days={30|90|365}
```

### Merchant Info
```
GET /v1/merchants/{merchant_id}
```

## MCP Tools

For AI agent integration, BuyWhere provides MCP tools:

- `search_products` — Full-text product search with filters for keyword, merchant, price, category, country, currency
- `get_product` — Get full product details by BuyWhere product ID
- `compare_products` — Compare 2–10 products side-by-side across merchants
- `get_deals` — Find discounted products sorted by discount percentage
- `list_categories` — List top-level product categories with product counts
- `find_best_price` — Find the cheapest current listing across all merchants

## Code Examples

### cURL
```bash
curl "https://api.buywhere.ai/v1/products/search?q=MacBook+Air&country=us" \
  -H "X-API-Key: your-api-key"
```

### JavaScript/TypeScript
```javascript
const response = await fetch(
  'https://api.buywhere.ai/v1/products/search?q=MacBook+Air&country=us',
  { headers: { 'X-API-Key': process.env.BUYWHERE_API_KEY } }
);
const { items } = await response.json();
```

### Python
```python
import requests

response = requests.get(
    'https://api.buywhere.ai/v1/products/search',
    params={'q': 'MacBook Air', 'country': 'us'},
    headers={'X-API-Key': 'your-api-key'}
)
items = response.json()['items']
```

## Use Cases

1. **Shopping agents** — AI agents that recommend products and show live prices
2. **Deal aggregators** — Sites that compile deals across multiple retailers
3. **Price comparison dashboards** — Tools that compare prices for users
4. **Affiliate marketing** — Generate monetized product links with live pricing
5. **Market research** — Pull product pricing data for competitive analysis

## Pricing

| Plan | Price | Monthly Calls | Features |
|------|-------|---------------|---------|
| Free | $0 | 1,000 | Basic search, no history |
| Developer | $29 | 50,000 | Full API, price history |
| Business | $99 | 500,000 | Priority support, webhooks |
| Enterprise | Custom | Unlimited | Dedicated infrastructure |

## Get Started

- [API Documentation](https://buywhere.ai/developers)
- [API Reference](https://buywhere.ai/pages/api-reference)
- [MCP Server Setup](https://buywhere.ai/compare/buywhere-mcp-developer-faq)
