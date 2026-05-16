---
sidebar_position: 1
title: "Search Products"
---

# Search Products

```
GET /v1/products/search
```

Full-text search across 5M+ products with filtering by country, brand, category, price range, and more.

## Request

### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | Yes | `Bearer <api_key>` |

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string | Yes | Search query (full-text search) |
| `country_code` | string | No | Two-letter country code: `SG`, `US`, `MY`, `TH`, `ID`, `VN`, `PH`. Default: `SG` |
| `region` | string | No | `SEA` for all Southeast Asian markets |
| `category` | string | No | Category name filter (case-insensitive partial match) |
| `brand` | string | No | Brand name filter (case-insensitive partial match) |
| `domain` | string | No | Retailer domain filter, e.g. `amazon.sg`, `lazada` |
| `min_price` | number | No | Minimum price in inferred currency |
| `max_price` | number | No | Maximum price in inferred currency |
| `currency` | string | No | Price currency. Default: inferred from `country_code` |
| `sort` | string | No | `relevance` (default), `price_asc`, `price_desc`, `discount_desc`, `newest` |
| `availability` | string | No | `in_stock`, `out_of_stock`, `preorder`, `discontinued` |
| `limit` | integer | No | Results per page. Default: `20`, max: `100` |
| `offset` | integer | No | Pagination offset. Default: `0` |
| `page` | integer | No | Page number (alternative to offset). `offset = (page - 1) * limit` |
| `fields` | string | No | Comma-separated list of fields to return (see below) |
| `compact` | boolean | No | `true` for smaller payloads optimized for AI agents |

### Available Fields

When using the `fields` parameter, you can request any combination of:

`id`, `name`, `price`, `url`, `merchant`, `category`, `country`, `description`, `image_url`, `images`, `brand`, `sku`, `mpn`, `gtin`, `availability`, `compare_at_price`, `rating`, `title`, `country_code`, `region`, `original_price`, `discount_pct`, `structured_specs`, `comparison_attributes`, `metadata`

## Example Request

```bash
curl -s "https://api.buywhere.ai/v1/products/search?q=wireless+headphones&country_code=SG&max_price=200&sort=price_asc&limit=5" \
  -H "Authorization: Bearer $BUYWHERE_API_KEY"
```

## Response

```json
{
  "results": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "title": "Sony WH-1000XM5 Wireless Headphones",
      "price": {
        "amount": 349.00,
        "currency": "SGD"
      },
      "merchant": "amazon.sg",
      "url": "https://www.amazon.sg/dp/B09XS7JWHH",
      "image_url": "https://m.media-amazon.com/images/I/51aXvjzcukL.jpg",
      "region": "SG",
      "country_code": "SG",
      "updated_at": "2026-05-16T10:30:00Z",
      "metadata": {
        "brand": "Sony",
        "category_path": ["Electronics", "Headphones"],
        "rating": 4.7,
        "review_count": 1250
      },
      "original_price": 549.00,
      "discount_pct": 36
    }
  ],
  "total": 1842,
  "page": {
    "limit": 5,
    "offset": 0
  },
  "response_time_ms": 145,
  "cached": false
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `results` | array | Array of product objects |
| `results[].id` | string (UUID) | Unique product identifier |
| `results[].title` | string | Product name |
| `results[].price.amount` | number | Current price |
| `results[].price.currency` | string | Currency code (SGD, USD, etc.) |
| `results[].merchant` | string | Retailer domain |
| `results[].url` | string | Product page URL |
| `results[].image_url` | string | Primary product image URL |
| `results[].region` | string | Geographic region |
| `results[].country_code` | string | Two-letter country code |
| `results[].updated_at` | string (ISO 8601) | Last data refresh timestamp |
| `results[].original_price` | number | Price before discount (if discounted) |
| `results[].discount_pct` | number | Discount percentage (if discounted) |
| `results[].metadata` | object | Additional product data (brand, category, ratings) |
| `total` | integer | Total matching products |
| `page.limit` | integer | Results per page |
| `page.offset` | integer | Current offset |
| `response_time_ms` | integer | Server processing time in ms |
| `cached` | boolean | Whether the response was served from cache |

## More Examples

### Filter by brand

```bash
curl -s "https://api.buywhere.ai/v1/products/search?q=running+shoes&brand=Nike&limit=5" \
  -H "Authorization: Bearer $BUYWHERE_API_KEY"
```

### Search US products under $50

```bash
curl -s "https://api.buywhere.ai/v1/products/search?q=bluetooth+speaker&country_code=US&max_price=50&limit=5" \
  -H "Authorization: Bearer $BUYWHERE_API_KEY"
```

### Compact mode for AI agents

```bash
curl -s "https://api.buywhere.ai/v1/products/search?q=laptop+stand&compact=true&limit=10" \
  -H "Authorization: Bearer $BUYWHERE_API_KEY"
```

### Select specific fields

```bash
curl -s "https://api.buywhere.ai/v1/products/search?q=keyboard&fields=id,title,price,url&limit=5" \
  -H "Authorization: Bearer $BUYWHERE_API_KEY"
```
