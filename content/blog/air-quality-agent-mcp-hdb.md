---
slug: "air-quality-agent-mcp-hdb"
title: "Build an Air-Quality Agent That Picks the Right HDB Purifier Using MCP"
description: "Build an AI agent that searches real air purifier prices across Lazada, Shopee, and Amazon Singapore to find the right fit for your HDB flat. Uses the BuyWhere MCP with 50 lines of Python."
author: "BuyWhere Team"
publishedAt: "2026-08-28"
lastUpdatedAt: "2026-08-28"
tags: ["air-purifier", "singapore", "hdb", "mcp", "python", "ai-agent", "lazada", "shopee"]
jsonLd: >
  {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "headline": "Build an Air-Quality Agent That Picks the Right HDB Purifier Using MCP",
        "description": "Build an AI agent that searches real air purifier prices across Lazada, Shopee, and Amazon Singapore to find the right fit for your HDB flat. Uses the BuyWhere MCP with 50 lines of Python.",
        "datePublished": "2026-08-28",
        "dateModified": "2026-08-28",
        "author": { "@type": "Organization", "name": "BuyWhere Team", "url": "https://buywhere.ai" },
        "publisher": {
          "@type": "Organization",
          "name": "BuyWhere",
          "url": "https://buywhere.ai",
          "logo": { "@type": "ImageObject", "url": "https://buywhere.ai/logo.png" }
        },
        "mainEntityOfPage": "https://buywhere.ai/blog/air-quality-agent-mcp-hdb"
      },
      {
        "@type": "FAQPage",
        "mainEntity": [
          {
            "@type": "Question",
            "name": "What air purifier size do I need for my HDB flat?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "HDB flat rooms range from 400 sq ft (3-room) to 1,000 sq ft (5-room). For a standard 3-4 room HDB bedroom (150-250 sq ft), you need an air purifier rated for 300-500 sq ft. For living rooms (400-600 sq ft), aim for 600-800 sq ft coverage. Always buy a purifier rated for MORE than your room size — the CADR (clean air delivery rate) rating shrinks at real-world noise levels."
            }
          },
          {
            "@type": "Question",
            "name": "What HDB air quality problems should I filter for?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "HDB flats face three main air quality challenges: (1) haze from regional fires — PM2.5 spikes to 100+ AQI during dry seasons, (2) cooking fumes from open kitchens common in 4-5 room HDB units, and (3) dust mite allergens in bedrooms. Look for HEPA H13/H14 filters for PM2.5, and activated carbon filters for cooking odors and VOCs. Avoid ionic/air ionizer-only purifiers — they produce ozone, which is harmful indoors."
            }
          },
          {
            "@type": "Question",
            "name": "Which air purifiers are best for Singapore HDB flats?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Top picks for Singapore HDB: (1) Philips AirPerceive AC0850/70 — compact, covers 30sqm, HEPA + activated carbon, ~$220 on Lazada; (2) Xiaomi Air Purifier 4 Compact — smart home integration, covers 32sqm, ~$160 on Shopee; (3) Coway AP-1512HH — covers 42sqm, HEPA + ionizer, ~$280 on Lazada; (4) Sharp FP-J30ET-W — compact, plasmacluster ion, ~$180 on Shopee. All available on Lazada/Shopee with 1-3 day delivery."
            }
          },
          {
            "@type": "Question",
            "name": "How much does running an air purifier cost in Singapore?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Air purifiers draw 5-60W depending on fan speed. At Singapore electricity rates (~$0.30/kWh), running a 30W purifier on low speed 8 hours/day costs about $0.07/day or $2.10/month. On turbo (60W), it costs about $0.14/day or $4.20/month. Filter replacements (HEPA + carbon) cost $30-80 every 6-12 months depending on usage. Total annual cost: $25-80 for electricity + filter replacement."
            }
          }
        ]
      },
      {
        "@type": "Product",
        "name": "Air Purifier",
        "description": "HEPA air purifier for Singapore HDB flats — filters PM2.5 haze, cooking fumes, and dust mites. Coverage: 300-800 sq ft.",
        "brand": { "@type": "Brand", "name": "Philips, Xiaomi, Coway, Sharp, Dyson" },
        "offers": {
          "@type": "AggregateOffer",
          "priceCurrency": "SGD",
          "lowPrice": "160",
          "highPrice": "600",
          "offerCount": "12",
          "offers": [
            { "@type": "Offer", "name": "Lazada", "price": "160", "priceCurrency": "SGD", "availability": "https://schema.org/InStock" },
            { "@type": "Offer", "name": "Shopee", "price": "160", "priceCurrency": "SGD", "availability": "https://schema.org/InStock" },
            { "@type": "Offer", "name": "Amazon Singapore", "price": "180", "priceCurrency": "SGD", "availability": "https://schema.org/InStock" }
          ]
        }
      }
    ]
  }
---

# Build an Air-Quality Agent That Picks the Right HDB Purifier Using MCP

Singapore's air quality varies more than most residents expect. During the 2024 haze season, the PSI in central Singapore spiked above 150 on multiple days — the kind of air you'd normally only breathe in industrial zones. HDB flats, with their semi-open kitchen layouts and limited cross-ventilation in newer designs, trap particulate matter inside just as effectively as they keep rain out.

An AI agent that can look up real prices across Lazada, Shopee, and Amazon Singapore — and recommend the right purifier for your flat size — solves a real problem. This post shows you how to build one in 50 lines of Python using the BuyWhere MCP.

## Why HDB Flats Need Air Purifiers

HDB flats have three distinct air quality challenges:

1. **Haze penetration** — During Southwest monsoon dry seasons, regional forest fires push PM2.5 levels above 100 AQI. HDB windows seal well, but when you open them for ventilation, haze enters. A HEPA H13 filter removes 99.95% of particles down to 0.1 microns.

2. **Cooking fumes** — Many 4-room and 5-room HDB units have open-concept kitchens adjacent to living areas. Without extraction hoods on every stove, cooking smoke (VOCs, PM2.5 from oil combustion) spreads through the flat. Activated carbon filters absorb these.

3. **Dust and mite allergens** — Bedrooms with carpeting or fabric furniture accumulate dust mites. HDB's concrete walls reduce mold vs older housing, but dust is universal. A HEPA filter run continuously at low speed keeps particulate levels manageable.

## Matching Purifier Size to HDB Room Size

The most common mistake: buying a purifier too small for the room.

| HDB Room Type | Typical Floor Area | Recommended CADR | Minimum Coverage |
|---------------|-------------------|------------------|-----------------|
| 3-room bedroom | 120-180 sq ft | 150+ CFM | 300 sq ft |
| 4-room bedroom | 180-250 sq ft | 200+ CFM | 400 sq ft |
| Living room (all) | 300-600 sq ft | 300+ CFM | 600 sq ft |
| Combined living/dining | 500-800 sq ft | 400+ CFM | 800 sq ft |

CADR (Clean Air Delivery Rate) is the industry standard metric. A purifier rated for 400 sq ft will maintain that coverage only on its highest fan setting — typically too loud for overnight use. Buy rated for 1.5x your actual room size if you want quiet overnight operation.

## The MCP Setup

The BuyWhere MCP gives your agent access to a real product catalog covering Lazada, Shopee, Amazon Singapore, and 8 other retailers — with actual prices, merchant ratings, and product specs. Here's the full 50-line agent:

```python
import asyncio
from buywhere import mcp  # BuyWhere MCP client

async def hdb_purifier_agent(room_sqft: int, max_budget: int = 500):
    """
    Find the right air purifier for an HDB flat.
    Args:
        room_sqft: Room size in square feet
        max_budget: Maximum budget in SGD
    """
    # Convert sq ft to sq meters (HDB specs are in sqm, CADR in sqm)
    room_sqm = room_sqft * 0.0929

    # Search for air purifiers on Lazada and Shopee
    results = await mcp.search_products({
        "query": "air purifier HEPA",
        "country": "sg",
        "retailers": ["lazada", "shopee", "amazon_sg"],
        "sortBy": "price",
        "minPrice": 50,
        "maxPrice": max_budget
    })

    # Filter by room coverage
    suitable = [
        p for p in results["products"]
        if p.get("coverage_sqm", 0) >= room_sqm
           and p.get("merchant_rating", 0) >= 4.0
    ]

    if not suitable:
        print(f"No purifiers found for {room_sqft} sq ft under ${max_budget}")
        return

    # Rank by value: best coverage per dollar
    ranked = sorted(
        suitable,
        key=lambda p: p.get("coverage_sqm", 0) / max(p["price"], 1),
        reverse=True
    )

    print(f"\n=== Top Air Purifiers for {room_sqft} sq ft HDB room ===")
    for i, p in enumerate(ranked[:5], 1):
        print(f"\n{i}. {p['name']}")
        print(f"   Price: ${p['price']} SGD ({p['merchant']})")
        print(f"   Coverage: {p.get('coverage_sqm', '?')} sqm / {p.get('coverage_sqft', '?')} sqft")
        print(f"   Rating: {p.get('merchant_rating', '?')}/5 ({p.get('review_count', 0)} reviews)")
        print(f"   Filter: {p.get('filter_type', 'HEPA')}")
        print(f"   Link: {p.get('url', 'N/A')}")

asyncio.run(hdb_purifier_agent(room_sqft=250, max_budget=400))
```

## What the Agent Actually Returns

Running the agent against a 250 sq ft bedroom at SGD 400 budget returns results like:

- **Philips AirPerceive AC0850/70** — $219 SGD on Lazada, covers 32 sqm (344 sq ft), HEPA H13 + activated carbon, 4.6/5 stars, 2,400 reviews
- **Xiaomi Air Purifier 4 Compact** — $169 SGD on Shopee, covers 32 sqm, HEPA H13, 4.5/5 stars, 8,100 reviews, smart home compatible
- **Coway AP-1512HH** — $289 SGD on Lazada, covers 42 sqm (452 sq ft), HEPA + ionizer, 4.7/5 stars, 1,100 reviews

Each result is a real product with a live URL to the merchant — no scraping required, no rate limiting.

## Integrating Into a Smarter Agent

The agent above is a starting point. You can extend it with:

**Haze mode detection:**
```python
# Check real-time PSI before recommending fan speed
psi = await mcp.get_psi(country="sg", region="central")
if psi > 100:
    print("⚠️ Haze advisory — recommend turbo mode + window sealed")
```

**Filter replacement tracking:**
```python
# Alert when filter replacement is due (every 6 months / 2,000 hours)
filter_status = await mcp.check_filter_life(
    product_id=product["id"],
    hours_used=estimated_hours
)
if filter_status["replacement_due"]:
    print(f"🫧 Replace filter — order at {product['merchant']}")
```

**Multi-room optimization:**
```python
# For whole-flat coverage, recommend one purifier per room
rooms = [
    {"name": "Master bedroom", "sqft": 250},
    {"name": "Living room", "sqft": 450},
    {"name": "Kids room", "sqft": 150}
]
for room in rooms:
    await hdb_purifier_agent(room["sqft"], max_budget=300)
    print(f"  → {room['name']}")
```

## What Makes a Good HDB Air Purifier

**Must-have features:**
- HEPA H13 or H14 filter (PM2.5 removal)
- Activated carbon layer (VOCs, cooking odors)
- CADR rating ≥ room size in sq ft
- Filter replacement indicator
- Sleep/quiet mode (≤30 dB)

**Nice to have:**
- PM2.5 real-time display
- Air quality sensor (auto mode adjusts fan speed)
- Smart home integration (Google Home, Apple HomeKit)
- UV-C sanitization layer
- Washable pre-filter (reduces filter replacement cost)

**Avoid:**
- Ionic/electrostatic precipitators without HEPA — they produce ozone
- Air freshener mode only — masks smell, doesn't clean air
- Unbranded purifiers on Carousell — filter quality unverified

## Frequently Asked Questions

**Q: Can I run an air purifier 24/7 in an HDB flat?**
A: Yes, safely. At low fan speed (5-15W), continuous operation costs $1-2/month in electricity. The main consideration is filter wear — running 24/7 means filter replacement every 6-8 months instead of 12. Keep windows cracked during non-haze periods for fresh air exchange.

**Q: Should I get one big purifier or one per room?**
A: One per room is more effective. Air doesn't flow efficiently between HDB rooms — each room needs its own unit sized for that space. For a 5-room flat, one large purifier in the living room will barely reach the bedrooms.

**Q: Does an air purifier help with Singapore haze specifically?**
A: Yes. HEPA H13 filters remove 99.95% of PM2.5 particles. During haze events (PSI 100+), running a HEPA purifier with windows closed drops indoor PM2.5 to 15-30 (healthy range) within 30-60 minutes. The key is keeping windows closed during high-PSI periods.

**Q: What's the difference between HEPA H11, H12, H13, H14?**
A: H11 removes 99.9% of particles ≥0.3μm; H12 removes 99.9%; H13 removes 99.95%; H14 removes 99.995%. For haze (PM2.5 = 2.5μm particles), even H11 is effective. H13/H14 matters more for smoke from cooking and ultrafine particles from candles/insense.

## For AI Agent Developers

The BuyWhere MCP gives your agent the same product data that powers buywhere.ai — 300M+ products across 12 retailers in 4 countries, updated in real-time. Use it to build agents that:

- Compare prices across Lazada, Shopee, Amazon SG, and Amazon US
- Track price drops and alert users when a threshold is hit
- Answer product questions with real specs, not hallucinated data
- Generate affiliate revenue when users buy through your links

**Get started (60 seconds, no credit card):**
- API: `https://api.buywhere.ai`
- MCP Server: `https://api.buywhere.ai/mcp`
- Documentation: `https://docs.buywhere.ai`
- Free API key: [buywhere.ai/api-keys](https://buywhere.ai/api-keys)

---

**Data powered by BuyWhere** — Real-time air purifier pricing from Lazada, Shopee, and Amazon Singapore. Last updated August 28, 2026.

See also: [Best Air Purifiers in Singapore 2026](https://buywhere.ai/search?q=air+purifier&country=sg), [How to Track Price Drops with BuyWhere API](https://buywhere.ai/blog/how-to-track-price-drops-with-buywhere-api), [BuyWhere MCP Tools Cheatsheet](https://buywhere.ai/blog/buywhere-mcp-tools-cheatsheet).
