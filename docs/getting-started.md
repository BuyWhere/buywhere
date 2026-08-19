---
title: "Getting Started"
description: "BuyWhere is a product catalog API built for AI agents and developers. Search 5M+ products from 40+ retailers across Southeast Asia and the US, compare…"
public: true
---

# Getting Started

BuyWhere is a product catalog API built for AI agents and developers. Search 5M+ products from 40+ retailers across Southeast Asia and the US, compare prices, track deals, and integrate product data into any application or AI workflow.

## Get Your API Key

Register for a free API key:

```bash
curl -X POST https://api.buywhere.ai/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "agent_name": "my-shopping-agent",
    "email": "you@example.com",
    "use_case": "price comparison agent"
  }'
```

```json
{
  "api_key": "bw_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "tier": "unverified",
  "message": "Check your email to verify and unlock 60 req/min."
}
```

Save your key — it is shown only once. Verify your email to upgrade from 5 req/min to 60 req/min (free tier).

Or sign up at [buywhere.ai/api-keys](https://buywhere.ai/api-keys).

## Your First API Call

> **Recommended: MCP v2.** The new MCP tool surface (`search_products_v2`, `find_best_price_v2`, `get_deals_v2`) makes `deliver_to` a required parameter, so results rank for the end user's market and every row carries an `availability` label. The v1 REST endpoints below still work and are unchanged. See [agent-dx.md](agent-dx.md) for the full v1→v2 migration guide and the current rollout status of v2.

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

## Your First MCP v2 Call (recommended for agents)

If you are building an AI agent, prefer the v2 MCP tool surface. The single difference that matters: **v2 requires `deliver_to`**, the end-user's ISO 3166-1 alpha-2 country code.

### curl (MCP over HTTP)

```bash
export BUYWHERE_API_KEY="bw_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

curl -s https://api.buywhere.ai/mcp \
  -H "Authorization: Bearer $BUYWHERE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "search_products_v2",
      "arguments": {
        "query": "wireless headphones",
        "deliver_to": "SG",
        "limit": 3
      }
    }
  }' | jq .
```

### Python (MCP over HTTP)

```python
import httpx

API_KEY = "bw_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

resp = httpx.post(
    "https://api.buywhere.ai/mcp",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    },
    json={
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "search_products_v2",
            "arguments": {
                "query": "wireless headphones",
                "deliver_to": "SG",   # required on v2
                "limit": 3,
            },
        },
    },
    timeout=10,
)
data = resp.json()

for product in data["result"]["results"]:
    if product["availability"] == "in_stock":
        print(f"{product['title']} — {product['price']['currency']} {product['price']['amount']}")
```

`deliver_to` should come from the end user's profile, account, or a one-time confirmation — not a hardcoded guess. See [agent-dx.md](agent-dx.md) for the full v1 vs v2 comparison, the migration guide, and the current v2 rollout status.

## Pricing Tiers

| Tier | Requests/min | Requests/day | How to Get |
|------|-------------|-------------|------------|
| Unverified | 5 | 50 | [Register](https://buywhere.ai/api-keys) (instant) |
| Free | 60 | 1,000 | Verify email |
| Pro | 300 | 10,000 | [Contact sales](https://buywhere.ai/contact) |
| Enterprise | 1,000 | 100,000 | [Contact sales](https://buywhere.ai/contact) |

See [Pricing](https://buywhere.ai/pricing) for full details.

## What's Next

- [Authentication](/authentication) — API key usage, rate limits, and headers
- [API Reference](/api-reference/search) — full endpoint documentation
- [Error Reference](/errors) — all error codes and responses
- [Agent Developer Experience](/agent-dx) — v2 quickstart, v1 vs v2 comparison, migration guide
- [Build a Price Comparison Tool](/guides/price-comparison) — Python quickstart guide
- [MCP Integration](/guides/mcp-integration) — connect BuyWhere to Claude Desktop, Cursor, and other AI tools
