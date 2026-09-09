---
sidebar_position: 3
title: "Categories"
---

# Categories

## List Categories

```
GET /v1/categories
```

Returns all top-level product categories with product counts.

### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | Yes | `Bearer <api_key>` |

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `currency` | string | No | Currency for product counts. Default: `SGD` |

### Example Request

```bash
curl -s "https://api.buywhere.ai/v1/categories" \
  -H "Authorization: Bearer $BUYWHERE_API_KEY"
```

### Response

```json
{
  "data": [
    {
      "slug": "electronics",
      "name": "Electronics",
      "product_count": 45000
    },
    {
      "slug": "fashion",
      "name": "Fashion",
      "product_count": 32000
    },
    {
      "slug": "home-living",
      "name": "Home & Living",
      "product_count": 28000
    },
    {
      "slug": "beauty",
      "name": "Beauty",
      "product_count": 15000
    }
  ],
  "meta": {
    "total": 23,
    "response_time_ms": 145
  }
}
```

---

## Get Category Detail

```
GET /v1/categories/{slug}
```

Returns a category with its subcategories and products.

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `slug` | string | Yes | Category slug (e.g. `electronics`) |

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `currency` | string | No | Default: `SGD` |
| `limit` | integer | No | Products per page. Default: `20`, max: `100` |
| `offset` | integer | No | Pagination offset. Default: `0` |

### Example Request

```bash
curl -s "https://api.buywhere.ai/v1/categories/electronics?limit=5" \
  -H "Authorization: Bearer $BUYWHERE_API_KEY"
```

### Response

```json
{
  "data": {
    "slug": "electronics",
    "name": "Electronics",
    "product_count": 45000,
    "subcategories": [
      {
        "slug": "phones",
        "name": "Phones",
        "product_count": 12000
      },
      {
        "slug": "laptops",
        "name": "Laptops",
        "product_count": 8500
      },
      {
        "slug": "headphones",
        "name": "Headphones",
        "product_count": 6200
      }
    ],
    "products": [
      {
        "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "source": "src_abc123",
        "domain": "lazada",
        "url": "https://www.lazada.sg/products/...",
        "title": "Samsung Galaxy S24 Ultra",
        "price": 1698.00,
        "currency": "SGD",
        "image_url": "https://...",
        "updated_at": "2026-05-16T10:00:00Z"
      }
    ]
  },
  "meta": {
    "limit": 5,
    "offset": 0,
    "response_time_ms": 234
  }
}
```
