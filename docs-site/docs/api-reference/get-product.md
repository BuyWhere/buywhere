---
sidebar_position: 2
title: "Get Product"
---

# Get Product

```
GET /v1/products/{id}
```

Fetch full details for a single product by its UUID.

## Request

### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | Yes | `Bearer <api_key>` |

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string (UUID) | Yes | Product UUID |

## Example Request

```bash
curl -s "https://api.buywhere.ai/v1/products/a1b2c3d4-e5f6-7890-abcd-ef1234567890" \
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
        "description": "Industry-leading noise cancellation with Auto NC Optimizer...",
        "category_path": ["Electronics", "Headphones", "Over-Ear"],
        "rating": 4.7,
        "review_count": 1250,
        "availability": "in_stock",
        "sku": "WH1000XM5/B",
        "gtin": "0027242923782",
        "structured_specs": {
          "connectivity": "Bluetooth 5.2",
          "battery_life": "30 hours",
          "weight": "250g",
          "driver_size": "30mm"
        }
      },
      "original_price": 549.00,
      "discount_pct": 36
    }
  ],
  "total": 1,
  "page": { "limit": 1, "offset": 0 },
  "response_time_ms": 12,
  "cached": false
}
```

## Error Responses

### 404 — Product Not Found

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "The requested resource was not found.",
    "doc_url": "https://buywhere.ai/docs/errors#NOT_FOUND"
  }
}
```

### 401 — Missing or Invalid API Key

```json
{
  "error": {
    "code": "MISSING_API_KEY",
    "message": "API key is required. Pass as Authorization: Bearer <key>.",
    "doc_url": "https://buywhere.ai/docs/errors#MISSING_API_KEY"
  }
}
```
