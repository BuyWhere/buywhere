---
title: "What Is a Price Index? — Developer FAQ"
slug: "what-is-a-price-index"
description: "FAQ explaining what a price index is in the context of e-commerce and price tracking. Covers composite price indices, category indices, inflation indices, and how BuyWhere calculates and uses price indices."
category: FAQ
tags:
  - "price index"
  - "composite price index"
  - "price tracking index"
  - "category price index"
  - "price intelligence"
  - "developer price API"
  - "price benchmarking"
schema_type: Article
published: true
updated: 2026-05-08
---

# What Is a Price Index? — Developer FAQ

A price index is a normalised measure that tracks the relative price level of a product, category, or basket of goods over time. This FAQ covers what price indices are, how they are calculated, and how they are used in price intelligence.

---

## What Is a Price Index?

A price index is a number that represents the relative price of something at a point in time, expressed relative to a base period.

For example, if a product cost $100 in January (the base period) and $110 in March, the price index for March is 110 — prices have increased 10% from the base period.

```
Price Index = (Current Price / Base Price) × 100
           = ($110 / $100) × 100
           = 110
```

Price indices allow you to:
- Compare prices across different time periods
- Compare price movements across different products or categories
- Detect inflation or deflation in specific product categories

---

## Types of Price Indices

### Product-Level Price Index

Tracks the price of a single canonical product over time, relative to a base period.

```
Sony WH-1000XM5 Price Index
Base: January 2026 = 100

January 2026:  100  ($349)
February 2026:  98  ($342)
March 2026:    102  ($356)
April 2026:     95  ($331)
May 2026:       86  ($299) ← Black Friday
```

This is the most granular price index — tracking individual products.

### Category Price Index

Tracks the average price level of an entire product category (e.g., headphones, laptops) over time.

The category index is calculated as the weighted average of all product indices in the category:

```
Category Index = Σ(Product Index × Product Weight) / Σ(Product Weights)
```

Weights are typically based on sales volume or product importance.

### Composite Price Index

A composite index tracks multiple products or categories together to represent a broader market segment.

For example, a "consumer electronics price index" might combine:
- Audio (weight: 25%)
- Computing (weight: 35%)
- Displays (weight: 20%)
- Gaming (weight: 20%)

Composite indices are useful for understanding broad market price trends, not just individual product movements.

### Inflation-Adjusted Price Index

An inflation-adjusted price index accounts for general price inflation when evaluating whether a specific product category is getting more or less expensive.

```
Nominal price increase: +5%
General inflation:      +3%
Real price increase:    +2%
```

A product that increased 5% in price but general inflation was 8% actually became relatively cheaper in real terms.

---

## How Is a Price Index Calculated?

### Step 1: Choose a Base Period

Select a reference period to which all other periods are compared. The base period index = 100.

Base period selection matters:
- Recent base (last 3 months): Shows short-term price movements clearly
- Historical base (1+ years): Shows long-term trends but may miss category evolution

### Step 2: Collect Price Data

For each product in the index, collect price observations at regular intervals (daily, weekly, monthly).

### Step 3: Calculate Individual Product Indices

For each product:
```
Product Index(t) = (Price(t) / Base Price) × 100
```

### Step 4: Aggregate to Category or Composite Index

Combine individual product indices using chosen weights:

```
Category Index(t) = Σ(wi × Product Indexi(t)) / Σ(wi)
```

Where wi is the weight for product i.

### Step 5: Interpret Results

- Index > 100: Prices are higher than the base period
- Index < 100: Prices are lower than the base period
- Index = 100: Prices are at the base period level

---

## What Are Price Index Weights?

Weights determine how much each product contributes to the overall index. Common weighting schemes:

| Weight Type | How It Works | Use Case |
|-------------|-------------|----------|
| **Equal weight** | Each product contributes equally | Simple category averages |
| **Sales volume** | More popular products weighted higher | Consumer-facing price trends |
| **Revenue** | Higher-revenue products weighted higher | Economic analysis |
| **Survey-based** | Consumer-reported importance | Market research |

### Example: Equal-Weighted vs. Sales-Weighted

```
Product A: price dropped 50%, but only 1% of category sales
Product B: price increased 5%, but 99% of category sales

Equal-weighted index:    A's large drop dominates
Sales-weighted index:    B's small increase dominates
```

The choice of weighting fundamentally changes what the index represents.

---

## What Is a Price Index Used For?

### 1. Price Monitoring and Alerting

Price indices detect when prices move significantly:
- A product index spike (price jumped 30% overnight) might trigger a "price alert" for that specific product
- A category index spike might indicate a supplier-wide price increase

### 2. Market Trend Analysis

Composite price indices reveal whether a market segment is trending up or down:
- "Consumer electronics are 8% cheaper this quarter compared to last year"
- "Gaming consoles are at their lowest price index in 3 years"

### 3. Competitive Intelligence

Comparing your retailer's price index against competitors reveals pricing positioning:
- If competitor indices are falling faster than yours, you may be becoming uncompetitive
- If your index is stable while competitors' indices rise, you are gaining price competitiveness

### 4. Inflation Measurement

Category price indices track the real cost changes in specific product verticals, independent of general CPI:

- "Smartphone category price index declined 12% over 18 months" — phones are getting cheaper in real terms
- "Laptop category price index rose 4% over 6 months" — laptops are getting more expensive

### 5. Buy/Wait Recommendations

Price indices inform buy/wait signals:
- If the price index for a product is near its historical low, it is a good time to buy
- If the price index is near its historical high, wait for a better price

---

## How Does BuyWhere Calculate Price Indices?

BuyWhere calculates multiple layers of price indices:

### Product-Level Price Index

Each canonical product has a price index with configurable base period:
- Default base: 90-day rolling average
- Optional: Calendar base (January = 100)

The product price index is calculated from all retailer listing prices aggregated to the canonical product.

### Category Price Index

BuyWhere computes category-level indices using a sales-weighted composite of canonical product indices within each category.

### Retailer Price Index

A retailer-level index tracks the average price competitiveness of a specific retailer across their full product catalogue in BuyWhere.

### How BuyWhere Exposes Price Index Data

Via API:
- `GET /products/{id}/price-index` — returns product-level index and history
- `GET /categories/{id}/price-index` — returns category-level index and history
- `GET /retailers/{id}/price-index` — returns retailer competitiveness index

---

## What Is a Normalised Price Index?

A normalised price index rescales the index to a 0–100 or 0–1 range relative to a specific time window:

```
Normalised Index(t) = (Index(t) - Min Index) / (Max Index - Min Index)
```

This converts raw price movements to a 0–100 scale where:
- 100 = highest price in the tracked window
- 0 = lowest price in the tracked window
- 50 = midpoint

Normalised indices are useful for comparing price attractiveness across products with different absolute price levels.

---

## Limitations of Price Indices

### 1. Quality Changes

If a product is refreshed with new features, the price index may rise — but the new version may be genuinely worth the higher price. Pure price indices do not account for product quality changes.

### 2. Weight Staleness

If sales weight distributions shift (a new product gains popularity), an index with fixed weights becomes less representative of actual market conditions.

### 3. Base Period Effects

Long base periods may make the index less sensitive to recent market changes. Short base periods may produce volatile, noisy indices.

### 4. Cross-Category Comparisons

A 10% price increase in budget headphones is not comparable to a 10% increase in high-end televisions in consumer impact, even if the index change is identical.

---

## Related Questions

- [What Is Real-Time Price Data](/pages/what-is-real-time-price-data)
- [What Is a Price Comparison API](/pages/what-is-price-comparison-api)
- [How Price Tracking Works](/pages/how-price-tracking-works)
- [How to Read a Price History Chart](/pages/how-to-read-price-history-chart)
