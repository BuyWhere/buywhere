---
title: "Build a Product Research Tool with BuyWhere API — A Developer's Guide"
slug: "build-product-research-tool-buywhere-api"
description: "Step-by-step guide to building a product research tool using the BuyWhere API. Covers market analysis, competitor pricing, demand estimation, and category research with code examples in Node.js and Python."
category: Blog
tags:
  - "product research API"
  - "market analysis tool"
  - "BuyWhere API tutorial"
  - "competitor price analysis"
  - "product research development"
  - "e-commerce market research"
  - "developer tutorial"
schema_type: Article
published: true
updated: 2026-05-08
---

# Build a Product Research Tool with BuyWhere API — A Developer's Guide

Product research is the foundation of smart e-commerce decisions. Whether you're launching a new product, analysing competitor pricing, or building a market intelligence platform, having reliable product data is essential. The BuyWhere API gives you structured access to real-time pricing across 500+ retailers — the raw material for building powerful product research tools.

This guide walks through building a product research tool using the BuyWhere API, from basic price analysis to a full market research dashboard.

---

## What You'll Build

A product research tool that:
1. Analyses pricing distribution across retailers
2. Identifies market gaps and opportunities
3. Tracks competitor pricing over time
4. Generates category health scores

---

## Prerequisites

- Node.js 18+ or Python 3.9+
- A BuyWhere API key ([get one free](https://buywhere.ai/api-keys))

---

## 1. Install the SDK and Set Up

**Node.js:**

```bash
npm install @buywhere/sdk
```

**Python:**

```bash
pip install buywhere-sdk
```

---

## 2. Fetch Category Pricing Distribution

Understand how prices are distributed across retailers for any category.

```javascript
import { BuyWhere } from '@buywhere/sdk';

const client = new BuyWhere({ apiKey: process.env.BUYWHERE_API_KEY });

async function analysePricingDistribution(category, country = 'US') {
  const results = await client.products.search({
    query: category,
    country,
    limit: 100,
  });

  const prices = results.products.map(p => p.price);
  const sorted = [...prices].sort((a, b) => a - b);

  const stats = {
    count: prices.length,
    min: Math.min(...prices),
    max: Math.max(...prices),
    median: sorted[Math.floor(sorted.length / 2)],
    p25: sorted[Math.floor(sorted.length * 0.25)],
    p75: sorted[Math.floor(sorted.length * 0.75)],
    mean: prices.reduce((a, b) => a + b, 0) / prices.length,
  };

  return stats;
}

const stats = await analysePricingDistribution('wireless headphones', 'US');
console.log(stats);
// { count: 100, min: 15, max: 449, median: 79, p25: 45, p75: 149, mean: 98 }
```

---

## 3. Identify Price Gaps

Find price ranges where competition is low — opportunities for new entrants.

```javascript
async function findPriceGaps(category, country = 'US') {
  const results = await client.products.search({
    query: category,
    country,
    limit: 200,
  });

  const prices = results.products.map(p => p.price).sort((a, b) => a - b);
  const buckets = {};

  // Create $25 price buckets
  for (const price of prices) {
    const bucket = Math.floor(price / 25) * 25;
    buckets[bucket] = (buckets[bucket] || 0) + 1;
  }

  // Find gaps (buckets with no products)
  const occupiedBuckets = Object.keys(buckets).map(Number).sort((a, b) => a - b);
  const gaps = [];

  for (let i = 0; i < occupiedBuckets.length - 1; i++) {
    const current = occupiedBuckets[i];
    const next = occupiedBuckets[i + 1];
    if (next - current > 25) {
      gaps.push({ from: current, to: next, opportunity: `$${current + 1}-$${next - 1}` });
    }
  }

  return gaps;
}

const gaps = await findPriceGaps('laptop stands', 'US');
console.log(gaps);
// [{ from: 50, to: 100, opportunity: '$51-$99' }, { from: 175, to: 250, opportunity: '$176-$249' }]
```

---

## 4. Analyse Merchant Coverage

Understand which retailers dominate a category.

```javascript
async function analyseMerchantCoverage(category, country = 'US') {
  const results = await client.products.search({
    query: category,
    country,
    limit: 200,
  });

  const merchantCounts = {};
  const merchantPrices = {};
  const merchantRatings = {};

  for (const product of results.products) {
    const m = product.merchant;
    merchantCounts[m] = (merchantCounts[m] || 0) + 1;
    merchantPrices[m] = merchantPrices[m] || [];
    merchantPrices[m].push(product.price);
    if (product.rating) {
      merchantRatings[m] = merchantRatings[m] || [];
      merchantRatings[m].push(product.rating);
    }
  }

  const summary = Object.keys(merchantCounts).map(merchant => ({
    merchant,
    count: merchantCounts[merchant],
    avgPrice: merchantPrices[merchant].reduce((a, b) => a + b, 0) / merchantPrices[merchant].length,
    avgRating: merchantRatings[merchant]
      ? merchantRatings[merchant].reduce((a, b) => a + b, 0) / merchantRatings[merchant].length
      : null,
  })).sort((a, b) => b.count - a.count);

  return summary;
}

const coverage = await analyseMerchantCoverage('mechanical keyboards', 'US');
console.log(coverage);
// [{ merchant: 'amazon_us', count: 87, avgPrice: 89.5, avgRating: 4.3 }, ...]
```

---

## 5. Track Price Volatility

Identify products with high price swings — opportunities for deal finders.

```javascript
async function findPriceVolatileProducts(category, country = 'US') {
  const results = await client.products.search({
    query: category,
    country,
    limit: 50,
  });

  // In a real implementation, you'd compare current prices
  // to historical data from the price history endpoint
  // Here we use rating as a proxy for product quality

  const products = results.products.map(p => ({
    name: p.name,
    price: p.price,
    merchant: p.merchant,
    rating: p.rating,
    // Simulated volatility score (in production, use historical data)
    volatility: Math.random() * 100,
  }));

  return products
    .filter(p => p.volatility > 70)
    .sort((a, b) => b.volatility - a.volatility);
}

const volatile = await findPriceVolatileProducts('gaming mice', 'US');
console.log(volatile);
// Products with high price volatility — good for deal alerts
```

---

## 6. Build a Category Health Score

Score a category based on competition, pricing diversity, and merchant availability.

```javascript
async function categoryHealthScore(category, country = 'US') {
  const results = await client.products.search({
    query: category,
    country,
    limit: 100,
  });

  if (results.products.length === 0) {
    return { score: 0, label: 'No data' };
  }

  const prices = results.products.map(p => p.price);
  const merchants = [...new Set(results.products.map(p => p.merchant))];
  const ratings = results.products.map(p => p.rating).filter(Boolean);

  // Scoring components
  const competitionScore = Math.min(merchants.length / 10, 1) * 30; // Max 30 points
  const diversityScore = (prices.length > 50 ? 1 : prices.length / 50) * 30; // Max 30 points
  const qualityScore = ratings.length > 0
    ? (ratings.reduce((a, b) => a + b, 0) / ratings.length / 5) * 20
    : 0; // Max 20 points
  const priceRangeScore = (Math.max(...prices) / Math.min(...prices) > 5 ? 1 : 0) * 20; // Max 20 points

  const total = competitionScore + diversityScore + qualityScore + priceRangeScore;

  return {
    score: Math.round(total),
    label: total > 70 ? 'Healthy' : total > 40 ? 'Moderate' : 'Low competition',
    breakdown: {
      competition: Math.round(competitionScore),
      diversity: Math.round(diversityScore),
      quality: Math.round(qualityScore),
      priceRange: Math.round(priceRangeScore),
    },
    merchantCount: merchants.length,
    productCount: results.products.length,
  };
}

const health = await categoryHealthScore('laptops', 'US');
console.log(health);
// { score: 78, label: 'Healthy', breakdown: {...}, merchantCount: 8, productCount: 100 }
```

---

## 7. Generate a Market Research Report

Combine all the above into a comprehensive market research report.

```javascript
async function generateMarketReport(category, country = 'US') {
  const [pricing, merchantCoverage, gaps, health] = await Promise.all([
    analysePricingDistribution(category, country),
    analyseMerchantCoverage(category, country),
    findPriceGaps(category, country),
    categoryHealthScore(category, country),
  ]);

  return {
    category,
    country,
    generatedAt: new Date().toISOString(),
    pricing,
    merchantCoverage,
    priceGaps: gaps,
    health,
  };
}

const report = await generateMarketReport('smart watches', 'US');
console.log(JSON.stringify(report, null, 2));
```

---

## 8. Export to CSV

Export research data for use in spreadsheets or BI tools.

```javascript
function toCSV(data, columns) {
  const header = columns.join(',');
  const rows = data.map(row =>
    columns.map(col => {
      const val = row[col];
      return typeof val === 'string' && val.includes(',') ? `"${val}"` : val;
    }).join(',')
  );
  return [header, ...rows].join('\n');
}

async function exportCategoryResearch(category, country = 'US') {
  const coverage = await analyseMerchantCoverage(category, country);
  const csv = toCSV(coverage, ['merchant', 'count', 'avgPrice', 'avgRating']);
  require('fs').writeFileSync(
    `${category.replace(/ /g, '_')}_research.csv`,
    csv
  );
  console.log(`Exported to ${category}_research.csv`);
}
```

---

## Production Considerations

- **Rate limiting**: The BuyWhere free tier allows 1,000 calls/month. Cache results and refresh periodically.
- **Historical data**: Use price history endpoints to track volatility over time.
- **Granularity**: For market research, aggregate across 100+ products per category for meaningful statistics.
- **Multi-country**: Expand to Singapore, Malaysia, Thailand, and other SEA markets for regional research.

---

## Get Started

- [Get API key](https://buywhere.ai/api-keys) — free tier, 1,000 calls/month
- [API docs](https://api.buywhere.ai/docs)
- [MCP setup guide](https://buywhere.ai/integrate)

---

## Related Guides

- [Build a Price Comparison Tool with BuyWhere API](/blog/build-price-comparison-tool-buywhere-api) — Build a comparison site
- [Build a Deal Alert App with BuyWhere API](/blog/build-deal-alert-app-buywhere-api) — Build a deal alert app
- [Build an AI Shopping Agent with BuyWhere MCP](/blog/build-ai-shopping-agent-buywhere-mcp) — Build an AI shopping agent