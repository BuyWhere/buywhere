---
sidebar_position: 5
title: "Compare Products"
---

# Compare Products

```
GET /v1/products/compare
```

Side-by-side comparison of 2–10 products with normalized pricing and specs.

## Request

### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | Yes | `Bearer <api_key>` |

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `ids` | string | Yes | Comma-separated product UUIDs. Minimum 2, maximum 10. |

## Example Request

```bash
curl -s "https://api.buywhere.ai/v1/products/compare?ids=a1b2c3d4-...,f8e7d6c5-...,c3d4e5f6-..." \
  -H "Authorization: Bearer $BUYWHERE_API_KEY"
```

## Response

```json
{
  "results": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "title": "Sony WH-1000XM5",
      "price": {
        "amount": 349.00,
        "currency": "SGD"
      },
      "original_price": 549.00,
      "brand": "Sony",
      "rating": 4.7,
      "review_count": 1250,
      "domain": "amazon.sg",
      "url": "https://www.amazon.sg/dp/..."
    },
    {
      "id": "f8e7d6c5-b4a3-2190-fedc-ba0987654321",
      "title": "Bose QuietComfort Ultra",
      "price": {
        "amount": 429.00,
        "currency": "SGD"
      },
      "original_price": 499.00,
      "brand": "Bose",
      "rating": 4.6,
      "review_count": 890,
      "domain": "lazada",
      "url": "https://www.lazada.sg/products/..."
    }
  ],
  "total": 2,
  "page": { "limit": 2, "offset": 0 },
  "response_time_ms": 125,
  "cached": false,
  "currencies_mixed": false,
  "currency_warning": null
}
```

### Mixed Currency Warning

When compared products span multiple currencies, the response includes a warning:

```json
{
  "currencies_mixed": true,
  "currency_warning": "Products span multiple currencies — direct price comparison may be misleading."
}
```

## Error Responses

### 400 — Fewer Than 2 IDs

```json
{
  "error": "Provide at least 2 product IDs via ?ids=id1,id2"
}
```
