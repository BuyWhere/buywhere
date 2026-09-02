---
sidebar_position: 1
title: Getting Started
---

# Getting Started

BuyWhere is a product catalog API built for AI agents and developers. Search 5M+ products from 40+ retailers across Southeast Asia and the US, compare prices, track deals, and integrate product data into any application or AI workflow.

## Get Your API Key — instant, no signup

Get a key in 3 seconds — no signup, no email, no human in the loop:

```bash
curl -X POST https://api.buywhere.ai/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"agent_name": "my-shopping-agent"}'
```

```json
{
  "api_key": "bw_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "tier": "unverified",
  "email_verified": false,
  "rate_limit": { "rpm": 20, "daily": 1000 }
}
```

Save your key — it is shown only once. Unverified keys get **20 req/min, 1,000 req/day** with full product search access.

### Verify email to upgrade (optional)

If you want the higher Free tier (**60 req/min, 1,000 req/day** with priority support), verify the email attached to your key:

```bash
curl -X POST https://api.buywhere.ai/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "agent_name": "my-shopping-agent",
    "email": "you@example.com",
    "use_case": "price comparison agent"
  }'
```

You can also register through the [web form](https://buywhere.ai/api-keys) — both paths return the same key shape.

## Your First API Call

### curl

```bash
export BUYWHERE_API_KEY="bw_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

curl -s "https://api.buywhere.ai/v1/products/search?q=wireless+headphones&limit=3" \
  -H "Authorization: Bearer $BUYWHERE_API_KEY" | jq .
```

### Python

```python
import httpx

API_KEY = "bw_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

resp = httpx.get(
    "https://api.buywhere.ai/v1/products/search",
    params={"q": "wireless headphones", "limit": 3},
    headers={"Authorization": f"Bearer {API_KEY}"},
)
data = resp.json()

for product in data["results"]:
    print(f"{product['title']} — {product['price']['currency']} {product['price']['amount']}")
```

### Node.js

```typescript
const API_KEY = "bw_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

const res = await fetch(
  "https://api.buywhere.ai/v1/products/search?q=wireless+headphones&limit=3",
  { headers: { Authorization: `Bearer ${API_KEY}` } }
);
const data = await res.json();

data.results.forEach((p) =>
  console.log(`${p.title} — ${p.price.currency} ${p.price.amount}`)
);
```

### Example Response

```json
{
  "results": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "title": "Sony WH-1000XM5 Wireless Headphones",
      "price": { "amount": 349.00, "currency": "SGD" },
      "merchant": "amazon.sg",
      "url": "https://www.amazon.sg/dp/B09XS7JWHH",
      "image_url": "https://m.media-amazon.com/images/I/51aXvjzcukL.jpg",
      "region": "SG",
      "country_code": "SG",
      "original_price": 549.00,
      "discount_pct": 36
    }
  ],
  "total": 1842,
  "page": { "limit": 3, "offset": 0 },
  "response_time_ms": 145,
  "cached": false
}
```

## Pricing Tiers

| Tier | Requests/min | Requests/day | How to Get |
|------|-------------|-------------|------------|
| Unverified | 20 | 1,000 | `POST /v1/auth/register` (instant, no signup) |
| Free | 60 | 1,000 | Verify email |
| Pro | 300 | 10,000 | [Contact sales](https://buywhere.ai/contact) |
| Enterprise | 1,000 | 100,000 | [Contact sales](https://buywhere.ai/contact) |

See [Pricing](https://buywhere.ai/pricing) for full details.

## What's Next

- [Authentication](/docs/authentication) — API key usage, rate limits, and headers
- [API Reference](/docs/api-reference/search) — full endpoint documentation
- [Error Reference](/docs/errors) — all error codes and responses
- [Build a Price Comparison Tool](/docs/guides/price-comparison) — Python quickstart guide
- [MCP Integration](/docs/guides/mcp-integration) — connect BuyWhere to Claude Desktop, Cursor, and other AI tools
