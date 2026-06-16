---
title: "Deals"
description: "Find products with active discounts, sorted by discount percentage (highest first)."
public: true
---

# Deals

```
GET /v1/products/deals
```

Find products with active discounts, sorted by discount percentage (highest first).

## Request

### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | Yes | `Bearer <api_key>` |

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `min_discount` | number | No | Minimum discount percentage. Default: `10` |
| `country_code` | string | No | Two-letter country code. Default: `SG` |
| `currency` | string | No | Currency filter. Default: `SGD` |
| `limit` | integer | No | Results per page. Default: `20`, max: `100` |
| `offset` | integer | No | Pagination offset. Default: `0` |

## Example Request

```bash
curl -s "https://api.buywhere.ai/v1/products/deals?min_discount=20&country_code=SG&limit=5" \
  -H "Authorization: Bearer $BUYWHERE_API_KEY"
```

## Response

```json
{
  "results": [
    {
      "id": "f8e7d6c5-b4a3-2190-fedc-ba0987654321",
      "title": "Logitech MX Master 3S Wireless Mouse",
      "price": {
        "amount": 89.00,
        "currency": "SGD"
      },
      "merchant": "lazada",
      "url": "https://www.lazada.sg/products/...",
      "image_url": "https://...",
      "region": "SG",
      "country_code": "SG",
      "original_price": 159.00,
      "discount_pct": 44
    },
    {
      "id": "c3d4e5f6-a7b8-9012-cdef-345678901234",
      "title": "Anker Soundcore Life Q35 Headphones",
      "price": {
        "amount": 79.90,
        "currency": "SGD"
      },
      "merchant": "shopee",
      "url": "https://shopee.sg/...",
      "image_url": "https://...",
      "region": "SG",
      "country_code": "SG",
      "original_price": 149.90,
      "discount_pct": 47
    }
  ],
  "total": 8421,
  "page": { "limit": 5, "offset": 0 },
  "response_time_ms": 89,
  "cached": false
}
```
