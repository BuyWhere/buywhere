---
title: "Similar Products"
description: "Find products similar to a given product, based on brand, category, and title matching."
public: true
---

# Similar Products

```
GET /v1/products/{id}/similar
```

Find products similar to a given product, based on brand, category, and title matching.

## Request

### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | Yes | `Bearer <api_key>` |

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string (UUID) | Yes | Source product UUID |

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | integer | No | Number of similar products. Default: `8`, max: `20` |

## Example Request

```bash
curl -s "https://api.buywhere.ai/v1/products/a1b2c3d4-e5f6-7890-abcd-ef1234567890/similar?limit=5" \
  -H "Authorization: Bearer $BUYWHERE_API_KEY"
```

## Response

```json
{
  "data": [
    {
      "id": "b2c3d4e5-f6a7-8901-bcde-f23456789012",
      "source": "src_xyz789",
      "domain": "lazada",
      "url": "https://www.lazada.sg/products/...",
      "title": "Sony WH-1000XM4 Wireless Headphones",
      "price": 279.00,
      "currency": "SGD",
      "image_url": "https://...",
      "brand": "Sony",
      "category_path": ["Electronics", "Headphones"],
      "region": "SG",
      "country_code": "SG"
    },
    {
      "id": "c3d4e5f6-a7b8-9012-cdef-345678901234",
      "source": "src_abc456",
      "domain": "shopee",
      "url": "https://shopee.sg/...",
      "title": "Bose QuietComfort 45 Wireless Headphones",
      "price": 319.00,
      "currency": "SGD",
      "image_url": "https://...",
      "brand": "Bose",
      "category_path": ["Electronics", "Headphones"],
      "region": "SG",
      "country_code": "SG"
    }
  ],
  "meta": {
    "source_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "count": 5,
    "response_time_ms": 42
  }
}
```
