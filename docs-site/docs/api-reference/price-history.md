---
sidebar_position: 6
title: "Price History"
---

# Price History

```
GET /v1/products/{id}/price-history
```

Daily aggregated price trends for a product over up to 180 days.

## Request

### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | Yes | `Bearer <api_key>` |

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string (UUID) | Yes | Product UUID |

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `days` | integer | No | Number of days of history. Default: `30`, max: `180` |

## Example Request

```bash
curl -s "https://api.buywhere.ai/v1/products/a1b2c3d4-e5f6-7890-abcd-ef1234567890/price-history?days=30" \
  -H "Authorization: Bearer $BUYWHERE_API_KEY"
```

## Response

```json
{
  "data": {
    "product_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "title": "Sony WH-1000XM5 Wireless Headphones",
    "current_price": 349.00,
    "currency": "SGD",
    "daily": [
      {
        "day": "2026-05-16",
        "currency": "SGD",
        "min": 345.00,
        "max": 349.00,
        "avg": 347.50,
        "data_points": 8
      },
      {
        "day": "2026-05-15",
        "currency": "SGD",
        "min": 349.00,
        "max": 369.00,
        "avg": 355.00,
        "data_points": 6
      }
    ],
    "stats": {
      "min": 299.00,
      "max": 549.00,
      "avg": 375.50
    }
  },
  "meta": {
    "days": 30,
    "response_time_ms": 89
  }
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `data.product_id` | string | Product UUID |
| `data.current_price` | number | Latest price |
| `data.currency` | string | Currency code |
| `data.daily[]` | array | Daily price aggregations |
| `data.daily[].day` | string | Date (YYYY-MM-DD) |
| `data.daily[].min` | number | Lowest price recorded that day |
| `data.daily[].max` | number | Highest price recorded that day |
| `data.daily[].avg` | number | Average price that day |
| `data.daily[].data_points` | integer | Number of price observations |
| `data.stats.min` | number | All-time low in the period |
| `data.stats.max` | number | All-time high in the period |
| `data.stats.avg` | number | Average price across the period |

---

## Granular Price History

```
GET /v1/products/{id}/prices
```

Individual price observations with timestamps, for more detailed analysis.

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `days` | integer | No | Default: `30`, max: `90` |

### Example Response

```json
{
  "data": {
    "product_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "title": "Sony WH-1000XM5 Wireless Headphones",
    "current_price": 349.00,
    "currency": "SGD",
    "history": [
      { "price": 349.00, "currency": "SGD", "at": "2026-05-16T14:30:00Z" },
      { "price": 369.00, "currency": "SGD", "at": "2026-05-15T08:00:00Z" },
      { "price": 349.00, "currency": "SGD", "at": "2026-05-14T20:15:00Z" }
    ],
    "stats": {
      "min": 299.00,
      "max": 549.00,
      "avg": 375.50,
      "data_points": 142
    }
  },
  "meta": {
    "days": 30,
    "response_time_ms": 75
  }
}
```
