---
title: "BuyWhere API Reference — Product Search, Price Comparison & Deal Discovery"
slug: api-reference
description: BuyWhere REST API and MCP interface for product search, price comparison, and deal discovery across Shopee, Lazada, Amazon, Walmart, and FairPrice.
category: API Reference
tags:
  - api
  - api reference
  - rest api
  - mcp
  - product search api
  - price comparison api
  - deal discovery api
  - shopee api
  - lazada api
  - amazon api
  - walmart api
  - fairprice api
  - shopping api
  - e-commerce api
  - buywhere api
  - developer
  - documentation
  - endpoints
published: 2026-01-01
updated: 2026-05-06
---

# BuyWhere API Reference

## Overview

The BuyWhere API provides programmatic access to product search, price comparison, deal discovery, and category browsing across 7 e-commerce platforms in Singapore and the United States.

The API is available as:
- **REST API** — Standard HTTP endpoints for any HTTP client
- **MCP Interface** — Model Context Protocol tools for AI agents and LLM integrations

## Base URL

```
https://api.buywhere.ai/v1
```

## Authentication

Authenticate requests with an API key passed in the `X-API-Key` header:

```http
GET /v1/products/search?query=Sony+WH-1000XM5
X-API-Key: your_api_key_here
```

**Get your API key at:** [buywhere.ai/api](https://buywhere.ai/api)

## Endpoints

### Product Search

Search for products across all supported platforms.

```http
GET /v1/products/search
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query (e.g., "Sony WH-1000XM5") |
| `category` | string | No | Category slug (e.g., "electronics", "fashion") |
| `country` | string | No | `SG` or `US` (default: `SG`) |
| `limit` | integer | No | Number of results (default: 20, max: 100) |
| `offset` | integer | No | Pagination offset (default: 0) |

**Example response:**

```json
{
  "query": "Sony WH-1000XM5",
  "country": "SG",
  "total": 156,
  "products": [
    {
      "id": "bw_sg_sony_wh1000xm5_001",
      "name": "Sony WH-1000XM5 Wireless Noise Cancelling Headphones",
      "brand": "Sony",
      "category": "electronics",
      "imageUrl": "https://cdn.buywhere.ai/products/sony-wh1000xm5.jpg",
      "prices": [
        { "platform": "shopee", "price": 429.00, "url": "https://shopee.sg/product/sony-wh1000xm5" },
        { "platform": "lazada", "price": 449.00, "url": "https://lazada.sg/product/sony-wh1000xm5" },
        { "platform": "amazon_sg", "price": 459.00, "url": "https://amazon.sg/sony-wh1000xm5" }
      ],
      "lowestPrice": 429.00,
      "lowestPlatform": "shopee",
      "rating": 4.8,
      "reviewCount": 12453
    }
  ]
}
```

---

### Get Product Details

Retrieve detailed information for a specific product.

```http
GET /v1/products/:id
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Product ID (from search results) |

---

### Compare Products

Compare prices for a specific product across all platforms.

```http
GET /v1/products/compare
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `productId` | string | Yes | Product ID to compare |

**Example response:**

```json
{
  "productId": "bw_sg_sony_wh1000xm5_001",
  "name": "Sony WH-1000XM5 Wireless Noise Cancelling Headphones",
  "prices": [
    { "platform": "shopee", "price": 429.00, "originalPrice": 549.00, "discount": 22, "inStock": true, "url": "https://shopee.sg/..." },
    { "platform": "lazada", "price": 449.00, "originalPrice": 549.00, "discount": 18, "inStock": true, "url": "https://lazada.sg/..." },
    { "platform": "amazon_sg", "price": 459.00, "originalPrice": 499.00, "discount": 8, "inStock": true, "url": "https://amazon.sg/..." }
  ],
  "lowestPrice": { "platform": "shopee", "price": 429.00 }
}
```

---

### Discover Deals

Get current deals, discounts, and clearance items.

```http
GET /v1/products/deals
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `category` | string | No | Filter by category |
| `country` | string | No | `SG` or `US` (default: `SG`) |
| `minDiscount` | integer | No | Minimum discount percentage (e.g., 20 for 20%+ off) |
| `limit` | integer | No | Number of results (default: 20) |

---

### List Categories

Get all available product categories.

```http
GET /v1/categories
```

**Example response:**

```json
{
  "categories": [
    { "slug": "electronics", "name": "Electronics", "productCount": 45231 },
    { "slug": "fashion", "name": "Fashion", "productCount": 28453 },
    { "slug": "beauty", "name": "Beauty & Personal Care", "productCount": 12456 },
    { "slug": "grocery", "name": "Grocery & Supermarket", "productCount": 18923 },
    { "slug": "sports", "name": "Sports & Outdoors", "productCount": 8765 },
    { "slug": "home", "name": "Home & Living", "productCount": 15234 },
    { "slug": "toys", "name": "Toys & Games", "productCount": 5643 }
  ]
}
```

---

### Get Category

Get details for a specific category.

```http
GET /v1/categories/:slug
```

---

### Find Best Price

Find the best price for a specific product across all platforms.

```http
GET /v1/products/best-price
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `productName` | string | Yes | Product name to search |
| `country` | string | No | `SG` or `US` (default: `SG`) |

---

### Price History

Get historical price data for a specific product.

```http
GET /v1/products/:id/price-history
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Product ID |
| `days` | integer | No | Number of days of history (default: 30, max: 365) |

---

### Get Similar Products

Get similar or alternative products.

```http
GET /v1/products/:id/similar
```

---

## MCP Tools

If using the Model Context Protocol interface, the following tools are available:

### `search_products`

Search for products across all supported platforms.

```json
{
  "name": "search_products",
  "description": "Search for products across Shopee, Lazada, Amazon, and more",
  "parameters": {
    "type": "object",
    "properties": {
      "query": { "type": "string" },
      "category": { "type": "string" },
      "country": { "type": "string", "enum": ["SG", "US"] }
    }
  }
}
```

### `get_product`

Retrieve details for a specific product.

```json
{
  "name": "get_product",
  "description": "Get detailed product information by ID",
  "parameters": {
    "type": "object",
    "properties": {
      "productId": { "type": "string" }
    }
  }
}
```

### `compare_products`

Compare prices for a product across all platforms.

```json
{
  "name": "compare_products",
  "description": "Compare product prices across multiple retailers",
  "parameters": {
    "type": "object",
    "properties": {
      "productId": { "type": "string" }
    }
  }
}
```

### `get_deals`

Get current deals and discounts.

```json
{
  "name": "get_deals",
  "description": "Discover current deals, sales, and clearance items",
  "parameters": {
    "type": "object",
    "properties": {
      "category": { "type": "string" },
      "country": { "type": "string", "enum": ["SG", "US"] },
      "minDiscount": { "type": "integer" }
    }
  }
}
```

### `list_categories`

List all available product categories.

```json
{
  "name": "list_categories",
  "description": "Get all available product categories"
}
```

### `find_best_price`

Find the best price for a product.

```json
{
  "name": "find_best_price",
  "description": "Find the lowest price for a product across all platforms",
  "parameters": {
    "type": "object",
    "properties": {
      "productName": { "type": "string" },
      "country": { "type": "string", "enum": ["SG", "US"] }
    }
  }
}
```

## Error Codes

| Code | Description |
|------|-------------|
| `400` | Bad request — missing or invalid parameters |
| `401` | Unauthorized — invalid or missing API key |
| `403` | Forbidden — API key does not have access to this resource |
| `404` | Not found — product or category does not exist |
| `429` | Rate limited — too many requests |
| `500` | Internal server error |

## Rate Limits

| Plan | Requests/minute | Requests/month |
|------|----------------|----------------|
| Free | 10 | 1,000 |
| Starter | 60 | 50,000 |
| Pro | 200 | 500,000 |
| Enterprise | Custom | Custom |

## SDKs

- **Python**: `pip install buywhere`
- **TypeScript/JavaScript**: `npm install @buywhere/sdk`

## Get Started

1. **Sign up** at [buywhere.ai/api](https://buywhere.ai/api)
2. **Get your API key** from the dashboard
3. **Make your first request** using the REST API or MCP interface
4. **Explore the docs** for code examples and integration guides

## Related Documentation

- [BuyWhere LangChain Integration](https://buywhere.ai/compare/buywhere-langchain)
- [BuyWhere LlamaIndex Integration](https://buywhere.ai/compare/buywhere-llamaindex)
- [BuyWhere MCP Quick Reference](https://buywhere.ai/compare/buywhere-mcp-quick-reference)
- [Developer FAQ](https://buywhere.ai/compare/buywhere-developer-faq)
