---
title: "What Is Assortment Analytics? — Developer FAQ"
slug: "what-is-assortment-analytics"
description: "FAQ explaining what assortment analytics is in e-commerce and price intelligence. Covers assortment breadth, depth, competitive assortment analysis, and how BuyWhere supports assortment intelligence."
category: FAQ
tags:
  - "assortment analytics"
  - "product assortment"
  - "assortment analysis"
  - "competitive assortment"
  - "retail analytics"
  - "category breadth"
  - "e-commerce analytics"
schema_type: Article
published: true
updated: 2026-05-08
---

# What Is Assortment Analytics? — Developer FAQ

Assortment analytics is the practice of analysing the breadth, depth, and composition of a product assortment to understand market coverage and competitive positioning. This FAQ covers what assortment analytics is, how it works, and how BuyWhere supports assortment intelligence.

---

## What Is a Product Assortment?

A product assortment is the complete set of products a retailer offers for sale. Assortment is characterised by:

| Dimension | Description | Example |
|-----------|-------------|---------|
| **Breadth** | Number of distinct product categories | 50 categories vs. 100 categories |
| **Depth** | Number of SKUs within a category | 10 headphones vs. 50 headphones |
| **Width** | Total number of products in the assortment | 1,000 products vs. 10,000 products |

A retailer with a deep assortment in headphones but shallow assortment in TVs has a focused assortment strategy in audio.

---

## What Is Assortment Analytics?

Assortment analytics is the systematic analysis of a retailer's assortment to understand:

- **Coverage**: Which product categories does the retailer cover?
- **Depth**: How many SKUs do they carry per category?
- **Competitive positioning**: Where do they compete aggressively vs. where are they absent?
- **Gaps**: Which product opportunities are underserved?
- **Overlap**: How much do competing retailers overlap in assortment?

### Assortment vs. Assortment Analysis

- **Assortment**: The set of products a retailer carries
- **Assortment analytics**: The analysis of that assortment to derive insights

---

## Key Assortment Metrics

### Breadth Metrics

| Metric | What It Measures | How It's Calculated |
|--------|-----------------|---------------------|
| **Category count** | Number of categories covered | Count of unique Google Taxonomy IDs |
| **Category coverage** | % of target categories covered | Categories covered / total target categories |
| **Top-level breadth** | Number of top-level categories | Count of L1 categories |

### Depth Metrics

| Metric | What It Measures | How It's Calculated |
|--------|-----------------|---------------------|
| **SKUs per category** | Depth within each category | Count of SKUs / category |
| **Average depth** | Overall assortment depth | Total SKUs / categories with products |
| **Depth ratio** | Depth relative to competitors | SKUs per category / competitor SKUs per category |

### Concentration Metrics

| Metric | What It Measures | How It's Calculated |
|--------|-----------------|---------------------|
| **HHI (Herfindahl-Hirschman Index)** | Assortment concentration | Sum of squared market share by category |
| **Gini coefficient** | Assortment inequality | How unevenly distributed products are across categories |

---

## Competitive Assortment Analysis

Competitive assortment analysis compares your assortment against competitors:

### Overlap Analysis

```
Your Assortment:       500 products
Competitor A:          700 products
Overlap:               300 products
Jaccard similarity:    300 / (500 + 700 - 300) = 0.3

High overlap (0.7+):  Direct competition on most products
Medium overlap (0.3–0.7): Selective competition
Low overlap (0.0–0.3): Complementary assortments
```

### Unique Assortment Identification

Products you carry that competitors do not:
- These are your unique selling propositions
- Potential for premium pricing
- No direct price competition

### Gap Analysis

Products competitors carry that you do not:
- Market opportunities
- Potential for expansion
- Risk of losing customers who need those products

---

## Assortment and Price Intelligence

Assortment analytics connects with price intelligence in several ways:

### Price Position by Assortment Segment

```
Premium assortment:    Average price $450 (your prices 5% above market)
Mid-market assortment: Average price $150 (your prices 2% below market)
Budget assortment:     Average price $50  (your prices 1% above market)
```

Understanding which segments you compete in reveals pricing strategy effectiveness.

### Assortment-Level Price Indices

Price indices calculated at the assortment level:

```
Your headphone assortment index:  105 (5% above market average)
Competitor A headphone index:    98  (2% below market average)

Implication: Your headphone pricing is more premium than Competitor A's
```

### Competitive Intensity Mapping

Combining assortment overlap with price gap:

```
High overlap + Your price lower = Aggressive competitive positioning
High overlap + Your price higher = Premium positioning (requires justification)
Low overlap + Your price lower = Unserved market opportunity
Low overlap + Your price higher = Niche premium positioning
```

---

## Assortment Trends Over Time

Tracking assortment changes reveals strategy shifts:

| Change | What It Signals |
|--------|---------------|
| Breadth increase | Assortment expansion strategy |
| Depth increase | Deeper focus on existing categories |
| Breadth decrease | Assortment rationalisation |
| Category exit | Strategic withdrawal from category |
| New category entry | Market expansion or test |

### Assortment Velocity

How quickly a retailer changes their assortment:
- **High velocity**: Frequently adding/removing products (fast fashion, Amazon)
- **Low velocity**: Stable assortment (specialty retailers)

Fast-changing assortments require more frequent monitoring.

---

## Assortment Analysis and Pricing Strategy

Assortment informs pricing strategy:

### Assortment Leadership

Retailers with the deepest assortment in a category can influence market pricing:
- More SKUs = more price points = more competitive options for buyers
- Depth creates pricing power in that category

### Assortment as Moat

Deep, differentiated assortment creates a competitive moat:
- Competitors cannot easily replicate a 500-SKU assortment
- Customers seeking variety will come to the deep assortment retailer

### Assortment-Based Pricing Tiers

```
Core assortment:    Competitive pricing (traffic-driving)
Selected assortment: Premium pricing (margin-building)
Unique assortment:  Premium+ pricing (category authority)
```

---

## How Does BuyWhere Support Assortment Analytics?

BuyWhere provides assortment intelligence through its cross-merchant data:

### Cross-Merchant Assortment Coverage

For any product or category, BuyWhere can report:
- Which retailers carry the product
- How many SKUs each retailer has in the category
- Which retailers have the deepest assortment in the category

### Assortment Comparison

```
GET /v1/categories/{category_id}/assortment
Returns:
{
  "category": "Headphones (207)",
  "retailers": [
    {
      "retailer": "Amazon",
      "sku_count": 847,
      "avg_price": 189.00,
      "coverage": 0.82
    },
    {
      "retailer": "Best Buy",
      "sku_count": 312,
      "avg_price": 215.00,
      "coverage": 0.65
    }
  ]
}
```

### Competitive Assortment Report

```
GET /v1/retailers/{retailer_id}/assortment
Returns:
{
  "retailer": "BuyWhere",
  "total_skus": 15234,
  "category_breakdown": [
    { "category": "Electronics > Audio > Headphones", "sku_count": 847 },
    { "category": "Electronics > Computing > Laptops", "sku_count": 423 }
  ],
  "overlap_with_competitors": {
    "Amazon": 0.72,
    "Walmart": 0.45,
    "Target": 0.31
  }
}
```

---

## Assortment Analysis Limitations

### 1. Product Matching Complexity

Accurate assortment analysis requires correctly matching products across retailers. Without canonical product matching, the same product appearing under slightly different names at different retailers appears as two separate products.

### 2. Variant vs. Base Product

A SKU-level analysis may show retailer A has 100 headphones while retailer B has 50. But if retailer A's 100 SKUs are mostly colour variants of 10 base products while retailer B's 50 SKUs are 50 distinct models, the depth comparison is misleading.

### 3. Assortment Quality vs. Quantity

SKU count alone does not capture assortment quality. A retailer with 100 low-quality products has worse assortment than one with 20 premium products.

### 4. Stockout Blindness

Assortment analysis based on listed products does not capture actual availability. A retailer listing 500 products but only stocking 200 creates an inflated perception of assortment breadth.

---

## Related Questions

- [What Is Competitive Price Intelligence](/pages/what-is-competitive-price-intelligence)
- [What Is a Product Taxonomy](/pages/what-is-product-taxonomy)
- [What Is Retailer Price Monitoring](/pages/what-is-retailer-price-monitoring)
- [What Is a Price Benchmark](/pages/what-is-a-price-benchmark)
