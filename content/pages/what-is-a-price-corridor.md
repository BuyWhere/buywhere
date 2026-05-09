---
title: "What Is a Price Corridor? — Developer FAQ"
slug: "what-is-a-price-corridor"
description: "FAQ explaining what a price corridor is in price intelligence. Covers price floor and ceiling concepts, how price corridors are calculated, use in buy/wait decisions, and how BuyWhere calculates price corridors."
category: FAQ
tags:
  - "price corridor"
  - "price floor"
  - "price ceiling"
  - "price range"
  - "price intelligence"
  - "buy wait decision"
  - "price optimisation"
schema_type: Article
published: true
updated: 2026-05-08
---

# What Is a Price Corridor? — Developer FAQ

A price corridor defines the normal price range for a product — bounded by a floor (the lowest typical price) and a ceiling (the highest typical price). This FAQ covers what price corridors are, how they are calculated, and how they are used in price intelligence.

---

## What Is a Price Corridor?

A price corridor is a defined price range within which a product typically trades. The corridor is bounded by:

| Boundary | Description | Example |
|----------|-------------|---------|
| **Price floor** | The lowest typical price | $299 |
| **Price ceiling** | The highest typical price | $399 |
| **Corridor width** | The range between floor and ceiling | $100 |

The price corridor represents the "normal" price range, excluding extreme outliers (flash sales at abnormally low prices, or temporary inflation before a "sale").

### Price Corridor Diagram

```
Price
  │                                            ╱╲
  │                                           ╱  ╲  ← Price ceiling ($399)
  │                                          ╱    ╲
  │  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─╱──────╲────── ─ ─ ─ ─ ─ ─
  │                                         │      │
  │  ════════════════════════════════════════│══════│════════════════
  │     $299                                 │      │
  │  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─╱──────╲────── ─ ─ ─ ─ ─ ─
  │                                        ╱        ╲
  │                                       ╱          ╲  ← Price floor ($299)
  │                                      ╱            ╲
  └──────────────────────────────────────────────────────────────────► Time
```

---

## Why Does a Price Corridor Matter?

Without understanding the price corridor, you cannot answer:

- "Is the current price of $349 a good deal?"
- "Should I buy now or wait?"
- "Has this product's price permanently shifted lower?"

With a price corridor, you can:

- **Evaluate current price**: Is the current price near the floor (good) or near the ceiling (expensive)?
- **Make buy/wait decisions**: Buy when price is near the floor; wait when it is above average
- **Detect anomalies**: Identify when prices have moved permanently outside the normal corridor
- **Compare across products**: Normalise prices to a common scale (e.g., "this product is at 80% of its ceiling price")

---

## How Is a Price Corridor Calculated?

### Method 1: Historical Percentile

The price corridor is defined using historical price percentiles:

```
Floor = 10th percentile of historical prices
Ceiling = 90th percentile of historical prices
```

Using percentiles excludes extreme outliers (flash sales, price spikes) from the corridor definition:

```
Historical prices: [$299, $310, $315, $320, $325, $329, $349, $359, $399]

10th percentile = $299  (floor)
50th percentile = $320  (median)
90th percentile = $359  (ceiling)
```

The 10th–90th percentile range captures 80% of "normal" price variation, excluding the extremes.

### Method 2: Interquartile Range (IQR)

Statistical approach using quartiles:

```
Q1 = 25th percentile
Q3 = 75th percentile
IQR = Q3 - Q1
Floor = Q1 - 1.5 × IQR
Ceiling = Q3 + 1.5 × IQR
```

This method is more robust to outliers than simple percentiles.

### Method 3: Extreme Value Analysis

For products with infrequent price changes, extreme value theory models the probability of prices reaching extreme levels:

```
Floor = GEV(0.10)  # Value with 10% probability of being exceeded
Ceiling = GEV(0.90) # Value with 90% probability of being exceeded
```

This is more sophisticated and requires more data but handles non-normal distributions better.

### Method 4: Rule-Based

Simple business rules based on known sale patterns:

```
Floor = Minimum recorded price during major sale events (Black Friday, Prime Day)
Ceiling = MSRP (manufacturer's suggested retail price)
```

This is straightforward but depends on MSRP being a meaningful reference point.

---

## Price Corridor and Buy/Wait Decisions

The primary use of price corridors is informing buy/wait decisions:

### Buy Signal

**Current price near the floor** → Good time to buy

```
Price floor: $299
Current price: $309
Position: 10% above floor (near the bottom of the corridor)
Signal: Buy
```

### Wait Signal

**Current price near the ceiling** → Wait for a better price

```
Price ceiling: $399
Current price: $379
Position: 80% of the way to ceiling (near the top of the corridor)
Signal: Wait
```

### Neutral Signal

**Current price near the middle** → Either buy or wait depending on urgency

```
Price floor: $299, Price ceiling: $399
Current price: $349
Position: 50% of the corridor
Signal: Neutral
```

---

## Price Corridor Position

The price corridor position expresses the current price as a percentage of the corridor range:

```
Position = (current_price - floor) / (ceiling - floor) × 100

Position = 0%:   Current price at floor (cheapest)
Position = 50%:  Current price at midpoint
Position = 100%: Current price at ceiling (most expensive)
```

### Position Thresholds

| Position | Signal | Interpretation |
|----------|--------|---------------|
| 0–20% | Strong buy | Price is near the floor |
| 20–40% | Buy | Below average |
| 40–60% | Neutral | Average price |
| 60–80% | Wait | Above average |
| 80–100% | Wait | Price is near the ceiling |

---

## Price Corridor Width

The width of the corridor (ceiling minus floor) indicates price volatility:

| Width | Meaning | Implication |
|-------|---------|------------|
| Narrow | Stable price | No benefit to waiting |
| Wide | Volatile price | Significant savings possible by timing |
| Very wide | Extremely volatile | Difficult to predict; consider buying at reasonable levels |

### Width as Percentage of Price

```
Width % = (ceiling - floor) / floor × 100

Width % = 10%:  Very stable (no significant variation)
Width % = 33%:  Moderate volatility (meaningful savings from timing)
Width % = 100%: High volatility (price can double — wait for the bottom)
```

---

## Dynamic Price Corridors

The price corridor is not static. It evolves over time:

### Seasonality

Products have seasonal price corridors:

```
Product: Air conditioner

Summer corridor:  $300–$450  (higher demand)
Winter corridor: $250–$350  (lower demand)
```

Buying an air conditioner in winter uses the winter corridor, not the summer corridor.

### New Product Introduction

When a successor model launches, the previous model's corridor shifts:

```
Old model (pre-successor launch): $349–$399
Old model (post-successor launch): $249–$349 (corridor shifts lower)
```

### Market Shifts

Broader market changes can permanently shift corridors:

```
原材料价格上涨 → cost increase → floor and ceiling shift upward
Retailer exits market → reduced competition → ceiling shifts upward
```

---

## Price Corridor vs. Price Index

Price corridor and price index are related but distinct:

| | Price Corridor | Price Index |
|-|---------------|-------------|
| **What it measures** | Absolute price range (floor to ceiling) | Relative price level (current vs. base) |
| **Calculation** | Percentile of historical prices | (current / base) × 100 |
| **Use case** | Is this price near the floor? | Is price trending up or down? |
| **Example** | "Price floor is $299, current is $309 — near the bottom" | "Price index is 95 — 5% below the base period" |

Use both together: the price index tells you the trend; the price corridor tells you if the current price is historically cheap or expensive.

---

## Price Corridor and MAP Pricing

MAP (Minimum Advertised Price) creates a regulatory floor:

```
MAP: $299
Price floor (historical): $279
Effective floor: $299  (MAP is higher than historical floor)
```

In this case, the MAP becomes the effective floor — prices cannot legally go below $299 even if the historical floor was lower.

Similarly, if MSRP creates a natural ceiling:

```
MSRP: $449
Price ceiling (historical): $399
Effective ceiling: $449  (MSRP is above historical ceiling)
```

---

## How Does BuyWhere Calculate Price Corridors?

BuyWhere computes price corridors for all tracked canonical products:

### Default Corridor Calculation

BuyWhere uses the 10th–90th percentile method:

```
Floor = 10th percentile of last 365 days of price observations
Ceiling = 90th percentile of last 365 days of price observations
```

### Configurable Parameters

API consumers can request different corridor calculations:

```
GET /v1/products/{id}/corridor?method=percentile&low=15&high=85
GET /v1/products/{id}/corridor?method=iqr
GET /v1/products/{id}/corridor?method=gev
```

### Corridor in API Response

The corridor is included in the standard price response:

```json
{
  "product_id": "PRD-SONY-WH1000XM5-BLK",
  "current_price": 299.00,
  "corridor": {
    "floor": 299.00,
    "ceiling": 399.00,
    "position": 0.0,
    "position_label": "at_floor"
  },
  "price_summary": {
    "lowest_ever": 279.00,
    "highest_ever": 449.00,
    "lowest_current": 299.00
  }
}
```

---

## Related Questions

- [What Is a Price Benchmark](/pages/what-is-a-price-benchmark)
- [What Is a Price Index](/pages/what-is-a-price-index)
- [How to Read a Price History Chart](/pages/how-to-read-price-history-chart)
- [What Is Dynamic Pricing](/pages/what-is-dynamic-pricing)
