# API Reference

Complete reference for all BuyWhere API endpoints.

## Base URL

```
https://api.buywhere.ai
```

## Authentication

All endpoints require a Bearer token:

```
Authorization: Bearer bw_live_xxxxx
```

See the [Authentication Guide](../guides/authentication.md) for details.

## Table of Contents

- [Search Products](#search-products)
- [Get Product by ID](#get-product-by-id)
- [Best Price](#best-price)
- [Compare Products](#compare-products)
- [Compare Matrix](#compare-matrix)
- [Compare Diff](#compare-diff)
- [Trending Products](#trending-products)
- [Categories](#categories)
- [Export Products](#export-products)
- [Deals](#deals)
- [API Root](#api-root)
- [Health Check](#health-check)

---

## Search Products

Full-text search across all products.

```
GET /v1/search
```

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string | No | Full-text search query |
| `category` | string | No | Filter by category name (case-insensitive partial match) |
| `min_price` | number | No | Minimum price filter (SGD) |
| `max_price` | number | No | Maximum price filter (SGD) |
| `platform` | string | No | Filter by source platform (e.g., `lazada_sg`, `shopee_sg`) |
| `in_stock` | boolean | No | Filter by availability |
| `limit` | integer | No | Results per page (1-100, default: 20) |
| `offset` | integer | No | Pagination offset (default: 0) |

### Example

```bash
curl "https://api.buywhere.ai/v1/search?q=dyson%20vacuum&limit=10" \
  -H "Authorization: Bearer bw_live_xxxxx"
```

### Response

```json
{
  "total": 142,
  "limit": 10,
  "offset": 0,
  "has_more": true,
  "items": [
    {
      "id": 12345,
      "sku": "DY-VC7-XXXX",
      "source": "lazada_sg",
      "merchant_id": "LAZADA_SG_001",
      "name": "Dyson V15 Detect Vacuum Cleaner",
      "description": "Laser detects microscopic dust...",
      "price": "749.00",
      "currency": "SGD",
      "buy_url": "https://www.lazada.sg/products/...",
      "affiliate_url": "https://buywhere.ai/track/...",
      "image_url": "https://...jpg",
      "brand": "Dyson",
      "category": "Vacuum Cleaners",
      "category_path": ["Home & Garden", "Cleaning", "Vacuum Cleaners"],
      "rating": "4.8",
      "is_available": true,
      "last_checked": "2026-04-03T12:00:00Z",
      "metadata": null,
      "updated_at": "2026-04-03T14:30:00Z"
    }
  ]
}
```

---

## Get Product by ID

Retrieve a single product by its BuyWhere ID.

```
GET /v1/products/{product_id}
```

### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `product_id` | integer | The BuyWhere product ID |

### Example

```bash
curl "https://api.buywhere.ai/v1/products/12345" \
  -H "Authorization: Bearer bw_live_xxxxx"
```

### Response

Returns a single `Product` object. See [Product Schema](#product-schema).

---

## Best Price

Find the cheapest listing for a product across all platforms.

```
GET /v1/products/best-price
```

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string | Yes | Product name to search for |
| `category` | string | No | Optional category filter |

### Example

```bash
curl "https://api.buywhere.ai/v1/products/best-price?q=nintendo%20switch%20oled" \
  -H "Authorization: Bearer bw_live_xxxxx"
```

### Response

Returns a single `Product` object — the cheapest match.

### Error Responses

| Status | Description |
|--------|-------------|
| 404 | No products found for the query |

---

## Compare Products

Find all listings of the same product across platforms.

```
GET /v1/products/compare
```

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `product_id` | integer | Yes | Source product ID to find matches for |
| `min_price` | number | No | Minimum price filter for matches |
| `max_price` | number | No | Maximum price filter for matches |

### Example

```bash
curl "https://api.buywhere.ai/v1/products/compare?product_id=12345" \
  -H "Authorization: Bearer bw_live_xxxxx"
```

### Response

```json
{
  "source_product_id": 12345,
  "source_product_name": "Dyson V15 Detect Vacuum Cleaner",
  "matches": [
    {
      "id": 12346,
      "sku": "DY-VC7-YYY",
      "source": "shopee_sg",
      "merchant_id": "SHOPEE_SG_002",
      "name": "Dyson V15 Detect Vacuum Cleaner",
      "price": "729.00",
      "currency": "SGD",
      "buy_url": "https://shopee.sg/...",
      "affiliate_url": "https://buywhere.ai/track/...",
      "match_score": 0.95,
      ...
    }
  ],
  "total_matches": 5
}
```

---

## Compare Matrix

Compare multiple products across platforms in a single request.

```
POST /v1/products/compare
```

### Request Body

```json
{
  "product_ids": [12345, 67890, 11111],
  "min_price": 0,
  "max_price": 10000
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `product_ids` | array[integer] | Yes | List of 2-20 product IDs |
| `min_price` | number | No | Minimum price filter |
| `max_price` | number | No | Maximum price filter |

### Response

```json
{
  "comparisons": [
    {
      "source_product_id": 12345,
      "source_product_name": "Product A",
      "matches": [...],
      "total_matches": 5
    }
  ],
  "total_products": 3
}
```

---

## Compare Diff

Compare 2-5 products directly — returns structured field differences.

```
POST /v1/products/compare/diff
```

### Request Body

```json
{
  "product_ids": [12345, 67890, 11111],
  "include_image_similarity": false
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `product_ids` | array[integer] | Yes | List of 2-5 product IDs |
| `include_image_similarity` | boolean | No | Include image similarity computation |

### Response

```json
{
  "products": [
    {
      "id": 12345,
      "name": "Product A",
      "price": "749.00",
      "price_rank": 2,
      ...
    }
  ],
  "field_diffs": [
    {
      "field": "price",
      "values": ["749.00", "729.00", "799.00"],
      "all_identical": false
    }
  ],
  "identical_fields": ["brand", "category"],
  "cheapest_product_id": 67890,
  "most_expensive_product_id": 11111,
  "price_spread": "70.00",
  "price_spread_pct": 9.61
}
```

---

## Trending Products

Get recently updated products by category.

```
GET /v1/products/trending
```

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `category` | string | No | Filter by category name |
| `limit` | integer | No | Number of products (1-100, default: 50) |

### Example

```bash
curl "https://api.buywhere.ai/v1/products/trending?category=Electronics&limit=20" \
  -H "Authorization: Bearer bw_live_xxxxx"
```

---

## Categories

List all available product categories with item counts.

```
GET /v1/categories
```

### Example

```bash
curl "https://api.buywhere.ai/v1/categories" \
  -H "Authorization: Bearer bw_live_xxxxx"
```

### Response

```json
{
  "categories": [
    {"name": "Electronics", "count": 125000},
    {"name": "Fashion", "count": 98000},
    {"name": "Home & Garden", "count": 67000}
  ],
  "total": 45
}
```

---

## Export Products

Export products as CSV or JSON.

```
GET /v1/products/export
```

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `format` | string | No | Export format: `csv` or `json` (default: `json`) |
| `category` | string | No | Filter by category |
| `source` | string | No | Filter by source platform |
| `min_price` | number | No | Minimum price |
| `max_price` | number | No | Maximum price |
| `limit` | integer | No | Max records (1-10000, default: 1000) |
| `offset` | integer | No | Pagination offset (default: 0) |

### Example

```bash
curl "https://api.buywhere.ai/v1/products/export?format=csv&limit=100" \
  -H "Authorization: Bearer bw_live_xxxxx"
```

---

## Deals

Get products currently priced below their historical price.

```
GET /v1/deals
```

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `category` | string | No | Filter by category |
| `min_discount_pct` | number | No | Minimum discount % (default: 10) |
| `limit` | integer | No | Results per page (1-100, default: 20) |
| `offset` | integer | No | Pagination offset (default: 0) |

---

## API Root

Get API metadata and available endpoints.

```
GET /v1
```

### Response

```json
{
  "api": "BuyWhere Catalog API",
  "version": "v1",
  "endpoints": {
    "search": "GET /v1/search",
    "products": "GET /v1/products",
    "best_price": "GET /v1/products/best-price",
    "compare_single": "GET /v1/products/compare",
    "compare_matrix": "POST /v1/products/compare",
    "compare_diff": "POST /v1/products/compare/diff",
    "trending": "GET /v1/products/trending",
    "export": "GET /v1/products/export?format=csv|json",
    "product": "GET /v1/products/{id}",
    "categories": "GET /v1/categories",
    "deals": "GET /v1/deals"
  },
  "auth": "Bearer token required (API key)",
  "docs": "/docs"
}
```

---

## Health Check

Check API health status.

```
GET /health
```

### Response

```json
{
  "status": "ok",
  "version": "1.0.0",
  "environment": "production"
}
```

---

## Product Schema

All product-related endpoints return objects conforming to this schema:

| Field | Type | Description |
|-------|------|-------------|
| `id` | integer | BuyWhere product ID |
| `sku` | string | Product SKU |
| `source` | string | Source platform (e.g., `lazada_sg`, `shopee_sg`) |
| `merchant_id` | string | Merchant/shop identifier |
| `name` | string | Product title |
| `description` | string | Product description |
| `price` | string | Price as decimal string |
| `currency` | string | Currency code (e.g., `SGD`) |
| `buy_url` | string | Direct purchase URL |
| `affiliate_url` | string | Tracked affiliate URL |
| `image_url` | string | Product image URL |
| `brand` | string | Brand name |
| `category` | string | Primary category |
| `category_path` | array[string] | Full category hierarchy |
| `rating` | string | Product rating |
| `is_available` | boolean | Currently in stock |
| `last_checked` | datetime | Last availability check |
| `metadata` | any | Additional metadata |
| `updated_at` | datetime | Last update timestamp |

---

## Agent-Native Search

Optimized endpoints for AI agents with enhanced result metadata.

```
GET /v2/agents/search
```

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string | Yes | Natural language search query |
| `limit` | integer | No | Results per page (1-100, default: 10) |
| `offset` | integer | No | Pagination offset (default: 0) |
| `source` | string | No | Filter by source platform |
| `min_price` | number | No | Minimum price filter |
| `max_price` | number | No | Maximum price filter |
| `availability` | boolean | No | Filter by availability |
| `sort_by` | string | No | Sort by: `relevance`, `price_asc`, `price_desc`, `newest` |

### Response

```json
{
  "total": 142,
  "limit": 10,
  "offset": 0,
  "has_more": true,
  "query_processed": "dyson vacuum",
  "results": [
    {
      "id": 12345,
      "sku": "DY-VC7-XXXX",
      "source": "lazada_sg",
      "title": "Dyson V15 Detect Vacuum Cleaner",
      "price": "749.00",
      "currency": "SGD",
      "url": "https://...",
      "brand": "Dyson",
      "category": "Vacuum Cleaners",
      "image_url": "https://...jpg",
      "rating": 4.8,
      "review_count": 1234,
      "is_available": true,
      "confidence_score": 0.95,
      "availability_prediction": "in_stock",
      "competitor_count": 5,
      "buybox_price": "729.00",
      "affiliate_url": "https://buywhere.ai/track/..."
    }
  ],
  "query_time_ms": 45.2,
  "cache_hit": false
}
```

**Agent-specific fields:**

| Field | Type | Description |
|-------|------|-------------|
| `confidence_score` | float | Match quality (0-1) |
| `availability_prediction` | string | `in_stock`, `low_stock`, `out_of_stock`, `preorder`, `unknown` |
| `competitor_count` | integer | Number of same SKU on other platforms |
| `buybox_price` | string | Lowest price for this SKU across all sources |

---

## Agent Price Comparison

Compare product prices across platforms with savings calculations.

```
GET /v2/agents/price-comparison
```

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `product_name` | string | Yes | Product name to compare |
| `limit` | integer | No | Max results (1-50, default: 10) |
| `sources` | string[] | No | Filter by specific sources |
| `min_price` | number | No | Minimum price filter |
| `max_price` | number | No | Maximum price filter |
| `availability_only` | boolean | No | Only show in-stock products |
| `sort_by` | string | No | Sort by: `price_asc`, `price_desc`, `relevance`, `newest` |

### Response

```json
{
  "query": "nintendo switch oled",
  "query_processed": "nintendo switch oled",
  "total_results": 5,
  "limit": 10,
  "has_more": false,
  "price_stats": {
    "min": 385.00,
    "max": 459.00,
    "avg": 412.00,
    "median": 399.00
  },
  "results": [
    {
      "id": 12345,
      "title": "Nintendo Switch OLED",
      "price": "385.00",
      "currency": "SGD",
      "source": "shopee_sg",
      "price_rank": 1,
      "savings_vs_avg": "27.00",
      "savings_vs_max": "74.00",
      "best_deal": true
    }
  ],
  "best_deal": { ... },
  "query_time_ms": 62.1
}
```

---

## Agent Batch Lookup

Retrieve multiple products by ID efficiently.

```
POST /v2/agents/batch-lookup
```

### Request Body

```json
{
  "product_ids": [12345, 67890, 11111],
  "include_metadata": true,
  "affiliate_links": true
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `product_ids` | integer[] | Yes | List of 1-100 product IDs |
| `include_metadata` | boolean | No | Include metadata field |
| `affiliate_links` | boolean | No | Generate affiliate URLs |

### Response

```json
{
  "total": 3,
  "found": 3,
  "not_found": 0,
  "not_found_ids": [],
  "products": [ ... ],
  "cache_hit_rate": 0.67,
  "query_time_ms": 28.4
}
```

---

## Agent Explore

Randomized product exploration for discovering new products.

```
GET /v2/agents/explore
```

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | integer | No | Results per page (1-50, default: 10) |
| `category` | string | No | Filter by category |
| `source` | string | No | Filter by source platform |
| `min_price` | number | No | Minimum price filter |
| `max_price` | number | No | Maximum price filter |
| `availability` | boolean | No | Filter by availability |

---

## Semantic Search

Natural language search using embeddings for better understanding of intent.

```
GET /v1/search/semantic
```

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string | Yes | Semantic search query |
| `category` | string | No | Filter by category |
| `min_price` | number | No | Minimum price |
| `max_price` | number | No | Maximum price |
| `platform` | string | No | Filter by platform |
| `currency` | string | No | Target currency for conversion |
| `limit` | integer | No | Results (1-100, default: 20) |
| `offset` | integer | No | Pagination offset |

### Response Headers

| Header | Description |
|--------|-------------|
| `X-Semantic-Search` | `embeddings` or `fallback` |
| `X-Currency-Rate` | Currency conversion rate if applicable |

---

## Search Autocomplete

Get search suggestions as you type.

```
GET /v1/search/suggest
```

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string | Yes | Search prefix (min 1 char) |
| `limit` | integer | No | Max suggestions (1-20, default: 10) |
| `country` | string | No | Filter by country codes (e.g., `US,SG`) |

### Response

```json
{
  "query": "wire",
  "suggestions": [
    {"suggestion": "wireless headphones", "product_count": 1250},
    {"suggestion": "wireless earbuds", "product_count": 890}
  ],
  "total": 2
}
```

---

## Search Filters

Get available filter options with counts for dynamic filter UIs.

```
GET /v1/search/filters
```

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string | No | Scope filters to search results |

### Response

```json
{
  "categories": [{"value": "Electronics", "count": 125000}],
  "brands": [{"value": "Sony", "count": 8900}],
  "platforms": [{"value": "shopee_sg", "count": 45000}],
  "countries": [{"value": "SG", "count": 120000}],
  "price_ranges": [{"range": "100-200", "count": 8500}],
  "rating_ranges": [{"range": "4-5", "count": 15000}],
  "price_min": "0.00",
  "price_max": "5000.00"
}
```

---

## Image Search

Find products visually similar to an image.

```
POST /v1/search/image
```

### Request Body

```json
{
  "image_url": "https://example.com/product-image.jpg",
  "min_similarity": 0.8,
  "limit": 20
}
```

### Response

```json
{
  "query_image_url": "https://example.com/product-image.jpg",
  "total_matches": 5,
  "matches": [
    {
      "id": 12345,
      "name": "Similar Product",
      "price": "89.00",
      "similarity_score": 0.92,
      ...
    }
  ]
}
```

---

## Product Price History

Get historical price data for a product.

```
GET /v1/products/{product_id}/price-history
```

### Response

```json
{
  "product_id": 12345,
  "price_history": [
    {"date": "2026-04-01", "price": "749.00"},
    {"date": "2026-04-15", "price": "729.00"},
    {"date": "2026-04-20", "price": "749.00"}
  ],
  "currency": "SGD"
}
```

---

## Product Price Stats

Get price statistics for a product across all sellers.

```
GET /v1/products/{product_id}/price-stats
```

### Response

```json
{
  "product_id": 12345,
  "min_price": "729.00",
  "max_price": "799.00",
  "avg_price": "759.00",
  "median_price": "749.00",
  "price_count": 8,
  "currency": "SGD"
}
```

---

## Similar Products

Find products visually or semantically similar.

```
GET /v1/products/{product_id}/similar
```

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | integer | No | Max results (default: 10) |

---

## Countries

List available country filters.

```
GET /v1/countries
```

### Response

```json
{
  "countries": [
    {"code": "SG", "name": "Singapore", "product_count": 120000},
    {"code": "MY", "name": "Malaysia", "product_count": 85000},
    {"code": "US", "name": "United States", "product_count": 450000}
  ],
  "total": 5
}
```

---

## Brands

List brands with product counts.

```
GET /v1/brands
```

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | integer | No | Max results |
| `country` | string | No | Filter by country |

### Response

```json
{
  "brands": [
    {"name": "Sony", "product_count": 12500},
    {"name": "Samsung", "product_count": 9800}
  ],
  "total": 500
}
```

---

## Developer Signup

Register as a new API developer.

```
POST /v1/developers/signup
```

### Request Body

```json
{
  "email": "developer@example.com",
  "password": "secure-password",
  "name": "My App"
}
```

### Response

```json
{
  "developer_id": "dev_abc123",
  "api_key": "bw_live_xxxxx...",
  "tier": "free",
  "message": "Account created successfully"
}
```

---

## Webhooks

Manage webhooks for event notifications.

### Create Webhook

```
POST /v1/webhooks
```

```json
{
  "url": "https://your-app.com/webhook",
  "events": ["product.price_drop", "product.back_in_stock"],
  "secret": "your-webhook-secret"
}
```

### List Webhooks

```
GET /v1/webhooks
```

### Test Webhook

```
POST /v1/webhooks/test
```

```json
{
  "webhook_id": "wh_xxx",
  "event": "test"
}
```

**Available webhook events:**

| Event | Description |
|-------|-------------|
| `product.price_drop` | Product price decreased |
| `product.back_in_stock` | Product became available |
| `deal.new` | New deal detected |
| `price_alert.triggered` | Price alert threshold met |

---

## Error Codes

| Status | Code | Meaning |
|--------|------|---------|
| 400 | `BAD_REQUEST` | Invalid parameters |
| 401 | `INVALID_API_KEY` | Invalid or missing API key |
| 403 | `FORBIDDEN` | Invalid admin secret |
| 404 | `NOT_FOUND` | Resource doesn't exist |
| 422 | `VALIDATION_ERROR` | Request validation failed |
| 429 | `RATE_LIMIT_EXCEEDED` | Slow down requests |
| 500 | `INTERNAL_ERROR` | Something went wrong on our end |
| 503 | `SERVICE_UNAVAILABLE` | Temporary outage |

**Validation Error Response:**

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": {
      "errors": [
        {"field": "q", "message": "String exceeds maximum length of 500 characters", "type": "string_too_long"}
      ],
      "count": 1
    }
  }
}
```

**Rate Limit Response:**

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded",
    "details": {"retry_after": 60}
  }
}
```

---

## Rate Limits

| Tier | Limit |
|------|-------|
| Free | 100 requests/minute |
| Standard | 500 requests/minute |
| Premium | 1,000 requests/minute |
| Partner | Unlimited |

**Rate limit headers:**

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Your rate limit |
| `X-RateLimit-Remaining` | Requests remaining |
| `X-RateLimit-Reset` | Unix timestamp when limit resets |
| `Retry-After` | Seconds to wait (on 429) |