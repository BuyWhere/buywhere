---
slug: "how-to-track-price-drops-with-buywhere-api"
title: "How to Track Price Drops with BuyWhere API: A 2026 Developer's Guide"
description: "Track price drops across 300M+ products using BuyWhere's get_price_history and search_products endpoints. Step-by-step Node.js and Python code, polling cadence, alert thresholds, and a working deal-watcher pattern."
author: "BuyWhere Team"
publishedAt: "2026-08-18"
lastUpdatedAt: "2026-08-18"
tags: ["price-tracking", "api-tutorial", "developer-guide", "ai-agents", "nodejs", "python"]
jsonLd: >
  {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "headline": "How to Track Price Drops with BuyWhere API: A 2026 Developer's Guide",
        "description": "Track price drops across 300M+ products using BuyWhere's get_price_history and search_products endpoints. Step-by-step code, polling cadence, alert thresholds, and a working deal-watcher pattern.",
        "datePublished": "2026-08-18",
        "dateModified": "2026-08-18",
        "author": { "@type": "Organization", "name": "BuyWhere Team", "url": "https://buywhere.ai" },
        "publisher": {
          "@type": "Organization",
          "name": "BuyWhere",
          "url": "https://buywhere.ai",
          "logo": { "@type": "ImageObject", "url": "https://buywhere.ai/logo.png" }
        },
        "mainEntityOfPage": "https://buywhere.ai/blog/how-to-track-price-drops-with-buywhere-api"
      },
      {
        "@type": "FAQPage",
        "mainEntity": [
          {
            "@type": "Question",
            "name": "How often does BuyWhere update prices?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "BuyWhere refreshes most merchants' prices on sub-hour cadence. The get_price_history endpoint returns the recorded history for a product. For a proactive watcher, polling every 30–60 minutes per SKU is realistic; for an agent that watches 10,000+ SKUs, batch with get_deals(min_discount=...) instead."
            }
          },
          {
            "@type": "Question",
            "name": "What's the rate limit for price tracking?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Free tier: 100 requests/min. Partner tier: 1,000 requests/min. For a watcher that polls 1,000 SKUs every hour, you can comfortably fit on the free tier (1,000 calls/hour is below 1,000 calls/min)."
            }
          },
          {
            "@type": "Question",
            "name": "Can I get alerts when a product drops below a threshold?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Yes — use get_deals(min_discount=20, country_code=SG) for a periodic pull of all products with >=20% discount in a country, or poll get_price_history for a watched product and compare current price to your threshold. This guide walks through both patterns."
            }
          }
        ]
      }
    ]
  }
---

# How to Track Price Drops with BuyWhere API: A 2026 Developer's Guide

You want your agent to alert users when a product drops below a price, or to surface live deals. BuyWhere exposes two complementary endpoints: `get_price_history` (per-product history) and `get_deals` (country-wide discount feed). Here's how to wire them up.

**Quick Answer:** For a **watched-product alert**, poll `get_price_history` per SKU and compare to your threshold. For a **"what's on sale right now"** watcher, poll `get_deals(min_discount=20, country_code=SG)` periodically. Both endpoints are first-class MCP tools too.

## Prerequisites

- BuyWhere API key (free signup at [buywhere.ai/api-keys](https://buywhere.ai/api-keys), 1,000 requests/month)
- Node.js 18+ or Python 3.10+
- A list of products to watch (or a category filter)

## Pattern 1: Watched-product alerts

This is the case where you have a list of products the user cares about and you want to ping them when the price drops below a threshold.

### Step 1 — Find products to watch

```bash
curl -s "https://api.buywhere.ai/v1/products/search?q=sony+wh-1000xm5&country_code=SG&limit=5" \
  -H "Authorization: Bearer $BUYWHERE_API_KEY" | jq '.products[].id'
```

### Step 2 — Poll get_price_history

```javascript
// watch.js
const BUYWHERE = "https://api.buywhere.ai";
const KEY = process.env.BUYWHERE_API_KEY;

async function currentPrice(productId) {
  const url = `${BUYWHERE}/v1/products/${productId}/price-history`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` }});
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  // data.history is an array of {timestamp, price, currency}; last entry is current
  return data.history.at(-1);
}

async function watch(productId, threshold) {
  const last = await currentPrice(productId);
  if (last.price <= threshold) {
    console.log(`[ALERT] ${productId} dropped to ${last.price} ${last.currency} (threshold ${threshold})`);
    // → send email, webhook, push notification, etc.
  }
}

// Run every 30 minutes
setInterval(() => watch("PRODUCT_ID", 350), 30 * 60 * 1000);
```

### Step 3 — Persist and dedupe

To avoid re-alerting on the same drop, persist the last alerted price:

```javascript
// Simple file-based dedupe
import { readFile, writeFile } from "node:fs/promises";

const STATE_FILE = "./alert-state.json";

async function getState() {
  try { return JSON.parse(await readFile(STATE_FILE, "utf8")); }
  catch { return {}; }
}

async function shouldAlert(productId, currentPrice) {
  const state = await getState();
  const last = state[productId];
  if (last && last >= currentPrice) return false; // not a new low
  state[productId] = currentPrice;
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
  return true;
}
```

## Pattern 2: Pull all current deals

This is the case where you want to surface "everything on sale right now" without managing a watched list.

```python
# deals.py
import os, requests

API = "https://api.buywhere.ai"
KEY = os.environ["BUYWHERE_API_KEY"]

def fetch_deals(country="SG", min_discount=20, limit=100):
    resp = requests.get(
        f"{API}/v1/products/deals",
        params={
            "country_code": country,
            "min_discount": min_discount,
            "limit": limit,
        },
        headers={"Authorization": f"Bearer {KEY}"},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()["products"]

if __name__ == "__main__":
    deals = fetch_deals("SG", min_discount=30)
    for p in deals:
        print(f"{p['name']} — was {p['original_price']} now {p['price']} ({p['discount_pct']}% off) at {p['merchant']}")
```

`get_deals` returns ranked results by `discount_desc` (largest discount first). Run every 5–15 minutes; feed into a digest email, Telegram bot, or an agent's tool result.

## Pattern 3: MCP tool call

If you're embedding the watcher in an MCP-aware agent, the same lookup is one tool call:

```
get_price_history(product_id="abc-123")
→ { history: [{timestamp: "...", price: 379}, ...], currency: "SGD" }

get_deals(country_code="SG", min_discount=25)
→ { products: [...], total: 142 }
```

The MCP server at `https://api.buywhere.ai/mcp` exposes both. No API key copy-paste required for tools that route through the server.

## Polling cadence

| Workload | Cadence |
| --- | --- |
| Single watched product | 30–60 min |
| 10–100 watched products | 15–30 min |
| 1,000+ watched products | Use `get_deals` instead, 5–15 min |
| Real-time arbitrage | Sub-minute cadence will hit rate limits; partner tier required |

## Rate limit math

- Free tier: 100 requests/min
- Partner tier: 1,000 requests/min

For 1,000 SKUs polled every hour, that's ~17 requests/min average — well within free tier. For 10,000 SKUs every 5 min, that's 33 requests/sec — partner tier.

## Common questions

**Can I get push notifications instead of polling?** BuyWhere doesn't ship a webhook for price drops yet. Polling is the current pattern. If you need push, run the watcher on a cron and fire webhooks from your side.

**What currency does `get_price_history` return?** The currency of the merchant's listing at the time of the snapshot. If you want normalization, use `country_code=SG` to scope results and accept SGD.

**Does `get_price_history` include sale price and original price?** Yes — the history includes both `price` and `compare_at_price` when the merchant reports it. Use `discount_pct` for the simple comparison.

## Verdict

- **Watched products**: `get_price_history` + dedupe state
- **Live deal digest**: `get_deals(min_discount=...)` on a cron
- **Agent-native**: both are MCP tools, no wrapper needed

## Where to go next

- API keys → [buywhere.ai/api-keys](https://buywhere.ai/api-keys)
- Search endpoint → [buywhere.ai/docs/api-reference/search](https://buywhere.ai/docs/api-reference/search)
- Deals endpoint → [buywhere.ai/docs/api-reference/deals](https://buywhere.ai/docs/api-reference/deals)
- Price history → [buywhere.ai/docs/api-reference/price-history](https://buywhere.ai/docs/api-reference/price-history)
