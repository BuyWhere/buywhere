---
slug: "buywhere-api-rate-limits-and-best-practices"
title: "BuyWhere API Rate Limits and Best Practices in 2026"
description: "Free tier 100 requests/min, partner tier 1,000 requests/min, 1,000 requests/month free. Concrete backoff, batching, and caching strategies to keep your agent under the limit without missing results."
author: "BuyWhere Team"
publishedAt: "2026-08-18"
lastUpdatedAt: "2026-08-18"
tags: ["rate-limits", "api-best-practices", "developer-guide", "ai-agents", "caching", "batching"]
jsonLd: >
  {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "headline": "BuyWhere API Rate Limits and Best Practices in 2026",
        "description": "Free tier 100 requests/min, partner tier 1,000 requests/min, 1,000 requests/month free. Backoff, batching, and caching strategies.",
        "datePublished": "2026-08-18",
        "dateModified": "2026-08-18",
        "author": { "@type": "Organization", "name": "BuyWhere Team", "url": "https://buywhere.ai" },
        "publisher": {
          "@type": "Organization",
          "name": "BuyWhere",
          "url": "https://buywhere.ai",
          "logo": { "@type": "ImageObject", "url": "https://buywhere.ai/logo.png" }
        },
        "mainEntityOfPage": "https://buywhere.ai/blog/buywhere-api-rate-limits-and-best-practices"
      },
      {
        "@type": "FAQPage",
        "mainEntity": [
          {
            "@type": "Question",
            "name": "What is the BuyWhere API rate limit?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Free tier: 100 requests/min and 1,000 requests/month. Partner tier: 1,000 requests/min. Exceeding the rate limit returns HTTP 429 with a Retry-After header. The free tier is enough for prototypes, demos, and small production agents."
            }
          },
          {
            "@type": "Question",
            "name": "How do I get a higher rate limit?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Sign up for the partner tier via buywhere.ai/api-keys. Partner tier raises the limit to 1,000 requests/min and unlocks higher per-account request budgets. Enterprise plans with custom limits are available — contact sales."
            }
          },
          {
            "@type": "Question",
            "name": "What HTTP status does BuyWhere return on rate limit?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "HTTP 429 Too Many Requests, with a Retry-After header in seconds. Always read the Retry-After value and back off accordingly. Do not retry on a fixed interval — it will reset the rate window and trigger another 429."
            }
          }
        ]
      }
    ]
  }
---

# BuyWhere API Rate Limits and Best Practices in 2026

The free tier is generous, but "1,000 requests/month" and "100 requests/min" sound tighter than they are in practice. Here's how to think about the limits, what HTTP code they return, and the patterns that keep your agent under the bar without missing results.

**Quick Answer:** Free tier is **100 requests/min** and **1,000 requests/month**. On 429, back off using the `Retry-After` header. Use the `fields` parameter and `compact=true` to shrink payloads, and cache aggressively for any product the user will look at more than once.

## The limits

| Tier | Per-minute | Per-month | Authentication |
| --- | --- | --- | --- |
| Free (beta) | 100 requests/min | 1,000 requests | Bearer API key (signup at [buywhere.ai/api-keys](https://buywhere.ai/api-keys)) |
| Partner | 1,000 requests/min | Higher monthly cap | Bearer API key, partner tier |
| Enterprise | Custom | Custom | Custom |

The free tier is intended for prototypes, demos, and small production agents. The partner tier is for production at scale. The free tier is not a sandbox — it works for real workloads.

## What you get back on rate limit

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 12

{
  "error": "rate_limit_exceeded",
  "message": "Free tier limit is 100 requests/min. Upgrade to partner tier for 1,000 requests/min.",
  "retry_after_seconds": 12
}
```

The `Retry-After` header is in seconds. Honor it. Don't retry on a fixed interval — that will reset the rate window and trigger another 429.

## Best practice 1: Backoff on 429

```javascript
async function buywhereFetch(url, options, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const resp = await fetch(url, options);
    if (resp.status !== 429) return resp;
    const retryAfter = parseInt(resp.headers.get("Retry-After") || "5", 10);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
  }
  throw new Error("Rate limit retries exhausted");
}
```

For partner tier, the same pattern works — `Retry-After` is the single source of truth.

## Best practice 2: Use `fields` to shrink payloads

The default response includes every field on the product. For an agent that only needs name, price, and URL, request only those:

```bash
curl "https://api.buywhere.ai/v1/products/search?q=headphones&country_code=SG&fields=id,name,price,url&limit=20" \
  -H "Authorization: Bearer $BUYWHERE_API_KEY"
```

Shrinks payload size 5–10x. Smaller payloads = faster responses = lower wall-clock rate consumption.

## Best practice 3: Use `compact=true` for agents

`compact=true` returns a smaller payload optimized for AI agents — short field names, no nested arrays, no description blurb. It's the MCP-friendly shape.

```bash
curl "https://api.buywhere.ai/v1/products/search?q=headphones&country_code=SG&compact=true&limit=20" \
  -H "Authorization: Bearer $BUYWHERE_API_KEY"
```

If you're building an agent and don't need the full product schema, `compact=true` is the right default.

## Best practice 4: Cache aggressively

Most agent queries are short-lived ("what's the cheapest iPhone 17 in SG?"). The answer is stable for 5–15 minutes. Cache it.

```javascript
import { createClient } from "redis";

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

async function cachedSearch(query, ttlSeconds = 300) {
  const key = `bw:search:${query}`;
  const hit = await redis.get(key);
  if (hit) return JSON.parse(hit);
  const resp = await fetch(`https://api.buywhere.ai/v1/products/search?q=${encodeURIComponent(query)}&country_code=SG`, {
    headers: { Authorization: `Bearer ${process.env.BUYWHERE_API_KEY}` },
  });
  const data = await resp.json();
  await redis.set(key, JSON.stringify(data), { EX: ttlSeconds });
  return data;
}
```

300 seconds (5 min) is a reasonable default for product search. For price-history, longer TTL is fine — that data is historical, not real-time.

## Best practice 5: Batch with `get_deals`

If your agent needs "all current deals in SG", don't poll 1,000 individual products. Use `get_deals(min_discount=20, country_code=SG, limit=100)` once and slice the result.

```bash
curl "https://api.buywhere.ai/v1/products/deals?country_code=SG&min_discount=20&limit=100" \
  -H "Authorization: Bearer $BUYWHERE_API_KEY"
```

One call replaces 100 individual price-history calls.

## Best practice 6: Stay under the limit

For an agent that does 100 requests/min peak, here's a rough budget:

| Endpoint | Retry cost | Cache TTL |
| --- | --- | --- |
| `/search` | 1–2 / query | 5 min |
| `/deals` | 1 / refresh | 5 min |
| `/price-history` | 1 / SKU | 30 min |
| `/compare` | 1 / product | 5 min |
| `/get-product` | 1 / product | 10 min |

A typical agent does 5–10 requests per user turn. With caching, you can handle 10–20 concurrent users on the free tier without hitting the limit.

## When to upgrade to partner

Upgrade to partner tier when any of these are true:

- You sustain > 50 requests/min for more than 5 minutes
- You need a per-account monthly budget above 1,000 requests
- You want priority support and a custom integration window

Sign up at [buywhere.ai/api-keys](https://buywhere.ai/api-keys).

## Common questions

**Do MCP tool calls count against the rate limit?** Yes — every MCP tool call is a request to the underlying API. The same limits apply.

**Is there a burst allowance?** No — the per-minute limit is a soft sliding window. If you send 100 requests in 10 seconds, you cannot send another until 50 seconds have passed.

**Can I get a higher rate limit for a one-off job?** Yes — partner tier requests are reviewed within 1 business day. For proof-of-concept or seasonal workloads, this is faster than waiting on enterprise.

## Verdict

- **Read `Retry-After`** — never retry on a fixed interval
- **Use `fields` and `compact=true`** — shrink payloads
- **Cache common queries** — 5 min is a reasonable default
- **Use `get_deals`** instead of polling individual products
- **Monitor your usage** — the dashboard at [buywhere.ai/dashboard](https://buywhere.ai/dashboard) shows your rate-limit hits

## Where to go next

- Sign up → [buywhere.ai/api-keys](https://buywhere.ai/api-keys)
- API reference → [buywhere.ai/docs/api-reference](https://buywhere.ai/docs/api-reference)
- Dashboard → [buywhere.ai/dashboard](https://buywhere.ai/dashboard)
