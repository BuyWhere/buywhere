---
title: "Webhooks"
description: "Register a webhook URL to receive notifications when product prices change."
public: true
---

# Webhooks

**Info:**
Webhooks require a **Pro** or **Enterprise** tier API key.

```
POST /v1/webhooks
```

Register a webhook URL to receive notifications when product prices change.

## Request

### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | Yes | `Bearer <api_key>` |
| `Content-Type` | Yes | `application/json` |

### Request Body

```json
{
  "url": "https://your-server.com/webhooks/buywhere",
  "events": ["price_change"],
  "filters": {
    "product_ids": ["a1b2c3d4-...", "f8e7d6c5-..."],
    "min_price_change_pct": 5
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Yes | HTTPS URL to receive webhook payloads |
| `events` | array | Yes | Event types to subscribe to. Currently: `price_change` |
| `filters.product_ids` | array | No | Specific product UUIDs to monitor |
| `filters.min_price_change_pct` | number | No | Minimum price change percentage to trigger. Default: `1` |

## Example Request

```bash
curl -X POST "https://api.buywhere.ai/v1/webhooks" \
  -H "Authorization: Bearer $BUYWHERE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-server.com/webhooks/buywhere",
    "events": ["price_change"],
    "filters": {
      "min_price_change_pct": 10
    }
  }'
```

## Response

```json
{
  "id": "wh_abc123def456",
  "url": "https://your-server.com/webhooks/buywhere",
  "events": ["price_change"],
  "filters": {
    "min_price_change_pct": 10
  },
  "status": "active",
  "created_at": "2026-05-16T12:00:00Z"
}
```

## Webhook Payload

When a price change is detected, BuyWhere sends a POST request to your URL:

```json
{
  "event": "price_change",
  "timestamp": "2026-05-16T14:30:00Z",
  "data": {
    "product_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "title": "Sony WH-1000XM5 Wireless Headphones",
    "merchant": "amazon.sg",
    "previous_price": 399.00,
    "new_price": 349.00,
    "currency": "SGD",
    "change_pct": -12.5,
    "url": "https://www.amazon.sg/dp/B09XS7JWHH"
  }
}
```

Your server should respond with a `200` status within 10 seconds. Failed deliveries are retried up to 3 times with exponential backoff.

## Error Responses

### 403 — Tier Not Supported

```json
{
  "error": {
    "code": "INSUFFICIENT_SCOPE",
    "message": "API key does not have the required scope for this endpoint.",
    "doc_url": "https://buywhere.ai/docs/errors#INSUFFICIENT_SCOPE"
  }
}
```
