---
slug: "programmatic-affiliate-tracking-buywhere"
title: "Programmatic Affiliate Tracking with BuyWhere: A 2026 Developer Guide"
description: "How BuyWhere attaches affiliate IDs to product URLs, how tracked-vs-untracked attribution works, how to build a revenue-share dashboard, and why BuyWhere monetizes through affiliate fees instead of API rate limits."
author: "BuyWhere Team"
publishedAt: "2026-08-18"
lastUpdatedAt: "2026-08-18"
tags: ["affiliate-tracking", "developer-guide", "revenue-share", "ai-agents", "monetization"]
jsonLd: >
  {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "headline": "Programmatic Affiliate Tracking with BuyWhere: A 2026 Developer Guide",
        "description": "How BuyWhere attaches affiliate IDs to product URLs, how tracked-vs-untracked attribution works, how to build a revenue-share dashboard, and why BuyWhere monetizes through affiliate fees.",
        "datePublished": "2026-08-18",
        "dateModified": "2026-08-18",
        "author": { "@type": "Organization", "name": "BuyWhere Team", "url": "https://buywhere.ai" },
        "publisher": {
          "@type": "Organization",
          "name": "BuyWhere",
          "url": "https://buywhere.ai",
          "logo": { "@type": "ImageObject", "url": "https://buywhere.ai/logo.png" }
        },
        "mainEntityOfPage": "https://buywhere.ai/blog/programmatic-affiliate-tracking-buywhere"
      },
      {
        "@type": "FAQPage",
        "mainEntity": [
          {
            "@type": "Question",
            "name": "How does BuyWhere attach affiliate IDs to product URLs?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Every product URL returned by the BuyWhere API includes an affiliate tracking parameter tied to your account. When a user clicks through and completes a qualifying transaction, the merchant attributes the sale to BuyWhere, and BuyWhere shares a percentage of the resulting commission with the agent that drove the click."
            }
          },
          {
            "@type": "Question",
            "name": "Do I need a separate affiliate account to use BuyWhere?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "No. BuyWhere handles the affiliate network integration on the back-end. Your agent passes the user to a BuyWhere-tracked URL and BuyWhere attributes the eventual transaction. You don't need to enroll in CJ, Awin, or Involve.asia separately."
            }
          },
          {
            "@type": "Question",
            "name": "Why is the BuyWhere API free if every click earns affiliate revenue?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "BuyWhere monetizes through affiliate fees when a transaction completes through a BuyWhere-referred link. The API is free to keep the agent ecosystem open and to maximize the volume of qualifying clicks. This is the same model Wikipedia and many open-source projects use — free at the tool layer, paid at the conversion layer."
            }
          }
        ]
      }
    ]
  }
---

# Programmatic Affiliate Tracking with BuyWhere: A 2026 Developer Guide

BuyWhere is free to use. That's not a loss-leader — it's a deliberate design choice. The business model is **affiliate revenue**, and the API is engineered to make attribution straightforward. Here's how the tracking works and how to build on top of it.

**Quick Answer:** Every product URL returned by the BuyWhere API carries an affiliate tracking parameter. When the user completes a qualifying transaction, BuyWhere attributes the commission and shares it with the agent that drove the click. The agent developer doesn't need a separate affiliate network account.

## The flow

```
User asks agent → Agent calls BuyWhere → BuyWhere returns product list
                                          ↓
User clicks product URL → (redirected via BuyWhere tracker)
                                          ↓
User completes transaction at merchant → Merchant attributes sale to BuyWhere
                                          ↓
BuyWhere attributes sale to your agent → Revenue share paid out
```

## Step 1: Get a product list

```bash
curl "https://api.buywhere.ai/v1/products/search?q=playstation+5&country_code=SG&limit=5" \
  -H "Authorization: Bearer $BUYWHERE_API_KEY"
```

Each product has a `url` field. The URL already contains your affiliate tracking parameter — you don't need to add anything.

```json
{
  "id": "ps5-disc-sg-001",
  "name": "Sony PlayStation 5 Slim Disc Edition",
  "price": 549.0,
  "currency": "SGD",
  "merchant": "Courts",
  "url": "https://buywhere.ai/r/abc123?merchant=courts&product=ps5-disc-sg-001",
  "availability": "in_stock"
}
```

The `https://buywhere.ai/r/...` URL is a tracking redirect. When the user clicks, BuyWhere records the click, then redirects to the merchant's actual product page with the merchant's own affiliate ID attached.

## Step 2: Pass the user to the URL

In your agent's UI, render the `url` as a clickable link. The user clicks → BuyWhere records the click → user lands on the merchant's checkout.

```markdown
[Buy on Courts](https://buywhere.ai/r/abc123?merchant=courts&product=ps5-disc-sg-001)
```

That's the entire integration. BuyWhere handles the rest.

## Step 3: Read attribution reports

For an agent developer, you can fetch the click and conversion attribution via the dashboard at [buywhere.ai/dashboard](https://buywhere.ai/dashboard). For programmatic access, use the dashboard API:

```bash
curl "https://api.buywhere.ai/v1/affiliate/attribution?days=30" \
  -H "Authorization: Bearer $BUYWHERE_API_KEY"
```

Returns a list of clicks and conversions attributed to your account:

```json
{
  "clicks": 1247,
  "conversions": 89,
  "conversion_rate": 0.071,
  "estimated_revenue_sgd": 412.50,
  "by_merchant": [
    { "merchant": "Courts", "clicks": 412, "conversions": 31, "revenue_sgd": 168.00 },
    { "merchant": "Shopee SG", "clicks": 308, "conversions": 22, "revenue_sgd": 89.50 }
  ]
}
```

The dashboard at [buywhere.ai/dashboard](https://buywhere.ai/dashboard) renders this for human consumption; the API is for programmatic access.

## Why BuyWhere is free

Most commerce APIs charge per request. BuyWhere charges nothing for the API itself. The reason is structural:

- **API rate limits are a tax on agent development.** The faster agents can iterate, the more BuyWhere-tracked URLs they generate, the more affiliate revenue flows back.
- **Affiliate attribution is the durable monetization.** A free API drives volume; volume drives conversions; conversions drive revenue.
- **Agent developers are the distribution channel.** BuyWhere invests in the developers who use the API, not in CPC bidding for search traffic.

This is the same model many open-source projects use (free at the tool layer, paid at the conversion layer). BuyWhere is the commerce infrastructure; the agent ecosystem is the distribution.

## Building a revenue dashboard

For an agent that wants to show its own end-users the value it delivered, the attribution API is the data source:

```python
import requests

def fetch_attribution(days=30):
    resp = requests.get(
        f"https://api.buywhere.ai/v1/affiliate/attribution",
        params={"days": days},
        headers={"Authorization": f"Bearer {BUYWHERE_API_KEY}"},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()

def format_for_user(data):
    return (
        f"Over the last {data['clicks']} clicks, "
        f"{data['conversions']} resulted in purchases. "
        f"You saved an estimated ${data['estimated_revenue_sgd']} SGD."
    )
```

Render this in your agent's UI to close the loop with the user.

## Common concerns

### "I don't want to be an affiliate"

BuyWhere does not require you to disclose affiliate relationships in agent output. Many agents include "BuyWhere tracked" badges; you don't have to. Some regions require disclosure (US FTC, EU consumer protection) — check your local rules.

### "What if the user buys something different?"

BuyWhere attributes the sale to the original click's session. If the user clicks the PS5 link, lands on Courts, and buys a controller instead, the conversion still counts.

### "What commission rate does BuyWhere share?"

Revenue share is set per program tier. Partner tier agents get a higher share. The exact rate is published in your dashboard at [buywhere.ai/dashboard/affiliate](https://buywhere.ai/dashboard/affiliate).

### "Can I see the actual merchant URL?"

For debugging, pass `debug=true` to the API to get the raw merchant URL alongside the tracked URL. The default is to return only the tracked URL.

## Verdict

BuyWhere's affiliate model is the reason the API is free. As an agent developer, you get:

- Free API access (1,000 req/month free tier, 1,000 req/min partner tier)
- Free MCP server (open, no API key required)
- Built-in affiliate tracking on every product URL
- Revenue share on qualifying transactions
- Dashboard for human-readable attribution

The integration is one config block (MCP) or one HTTP call (REST). The monetization is closed-loop.

## Common questions

**Is the affiliate tracking opt-in?** Yes — your agent decides which URLs to render. If you don't want to earn revenue, render the merchant's URL directly (the API also returns raw merchant URLs in the response).

**What happens if a user clicks multiple products?** Each click is tracked separately. The first-touch attribution is preserved.

**Can I sub-attribute to multiple agents?** Yes — pass `sub_id=<your_agent_id>` to the URL and BuyWhere will track per-sub-id attribution.

## Where to go next

- API signup → [buywhere.ai/api-keys](https://buywhere.ai/api-keys)
- Dashboard → [buywhere.ai/dashboard](https://buywhere.ai/dashboard)
- API catalog → [buywhere.ai/.well-known/api-catalog](https://buywhere.ai/.well-known/api-catalog)
