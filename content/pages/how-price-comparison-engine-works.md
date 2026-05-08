---
title: "How a Price Comparison Engine Works — Developer Explainer"
slug: "how-price-comparison-engine-works"
description: "Technical explainer covering how a price comparison engine works end-to-end. From crawler scheduling and HTML parsing, through product normalisation and canonicalisation, to the API that serves comparison data."
category: Developer Guide
tags:
  - "price comparison engine"
  - "how price comparison works"
  - "product crawler architecture"
  - "price comparison API"
  - "price intelligence pipeline"
  - "developer commerce API"
schema_type: Article
published: true
updated: 2026-05-08
---

# How a Price Comparison Engine Works — Developer Explainer

A price comparison engine aggregates product listings from multiple retailers and presents them in a unified comparison view. This explainer covers the end-to-end architecture: crawling, parsing, normalisation, storage, and API delivery.

---

## High-Level Architecture

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│  Retailer   │   │  Retailer    │   │  Retailer   │   │  Retailer   │
│  Website A  │   │  Website B   │   │  Website C  │   │  Website D  │
└──────┬──────┘   └──────┬──────┘   └──────┬──────┘   └──────┬──────┘
       │                 │                 │                 │
       ▼                 ▼                 ▼                 ▼
┌──────────────────────────────────────────────────────────────┐
│                        Crawlers                               │
│  - Scheduled fetching (hourly / daily / on-demand)            │
│  - HTML parsing                                               │
│  - Structured data extraction                                 │
└────────────────────────────┬─────────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                    Product Normaliser                         │
│  - GTIN / model extraction                                   │
│  - Brand normalisation                                       │
│  - Variant resolution                                        │
│  - Bundle detection                                          │
└────────────────────────────┬─────────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                  Canonical Product Store                     │
│  - Canonical product records                                 │
│  - Retailer listing attachments                              │
│  - Price history per retailer                                │
└────────────────────────────┬─────────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                      Comparison API                          │
│  - Product lookup by canonical ID or query                    │
│  - Cross-retailer price aggregation                           │
│  - Price history and alert triggers                           │
└──────────────────────────────────────────────────────────────┘
```

---

## Stage 1: Crawling

Crawlers fetch product pages from retailer websites and extract structured product data.

### Crawler Types

**Scheduled crawlers** run on a fixed schedule (hourly, daily, weekly) based on:
- How frequently the retailer updates prices
- How large the product catalogue is
- How rate-limited the retailer allows

**On-demand crawlers** fetch product data when a user requests a comparison for a product not yet in the index.

**API crawlers** pull data from retailer product feeds (XML, CSV, JSON) when available — faster and more reliable than HTML scraping.

### What Crawlers Extract

From each product page, crawlers extract:
- Product title
- Brand and manufacturer
- Model number
- GTIN / UPC / EAN
- Price and currency
- Stock availability
- Product images
- Category / breadcrumbs
- Retailer product ID (SKU)

### Challenges

- **Dynamic content**: Many retailers load product data via JavaScript after page load. Headless browsers (Puppeteer, Playwright) handle this at higher cost.
- **Rate limiting**: Retailers block excessive crawling. Polite crawlers respect robots.txt and implement backoff.
- **CAPTCHA protection**: Some retailers serve CAPTCHAs to automated traffic.
- **Structured data inconsistency**: Even retailers with schema.org markup vary in which fields they populate.

---

## Stage 2: Product Normalisation

Raw crawled data goes through a normalisation pipeline that resolves inconsistencies across retailer data formats.

### Brand Normalisation

Each retailer formats brand names differently: "Apple", "APPLE", "apple inc.", "Apple Inc." all describe the same brand. Brand normalisation maps variants to a canonical brand name.

### Model Number Extraction

Model numbers are extracted from titles using patterns specific to each brand. "Sony WH-1000XM5", "Sony WH1000XM5", and "SN WH1000XM5" all reference the same model.

This requires:
- Brand-specific extraction patterns
- Handling of hyphenation, spacing, and abbreviation variations
- Contextual disambiguation when the same model number appears in multiple product lines

### GTIN Processing

GTINs are the most reliable matching signal. When available and valid, they anchor product matching.

GTIN validation checks:
- Check digit validity (the final digit is a calculated checksum)
- GS1 prefix validity
- Company prefix ownership

Invalid GTINs (incorrect check digits, made-up numbers) are discarded.

---

## Stage 3: Canonical Product Creation

Normalised listings are grouped into canonical products — the authoritative representation of each physical product.

### Matching Algorithm

Listings are matched into canonical products using a multi-signal approach:

1. **GTIN exact match** → same canonical product (highest confidence)
2. **Brand + model + variant match** → same canonical product (high confidence)
3. **Title similarity** → candidate match requiring review or exclusion (medium confidence)
4. **No match** → new canonical product created

### Variant Resolution

Variants (colour, size, storage) are separated before canonicalisation. "AirPods Pro White" and "AirPods Pro Black" become separate canonical products, each with their own price history.

Variant extraction identifies:
- Colour names from titles ("Black", "Midnight Green")
- Storage sizes ("128GB", "256GB")
- Size/designator variants ("Standard", "XL")

### Bundle Handling

Listings including additional products ("Sony WH-1000XM5 + Case") are flagged as bundles and canonicalised separately from the base product.

---

## Stage 4: Storage

Canonical products and their retailer listings are stored with supporting price history.

### Data Model

```
CanonicalProduct
  id: string (e.g., PRD-SONY-WH1000XM5-BLK)
  brand: string
  model: string
  variant: string (colour, size, storage)
  category: string
  first_seen: timestamp
  last_updated: timestamp

RetailerListing
  id: string
  canonical_product_id: string (FK)
  retailer: string
  retailer_product_id: string
  url: string
  price: number
  currency: string
  stock_status: enum (in_stock, out_of_stock, unknown)
  last_fetched: timestamp
  last_price_change: timestamp

PriceHistory
  retailer_listing_id: string (FK)
  price: number
  currency: string
  recorded_at: timestamp
```

### Price History Retention

Price history records are retained to support:
- Trend analysis (is this product trending up or down?)
- Average price calculation
- Lowest/highest price identification
- Sale event detection (price significantly below average)

---

## Stage 5: Comparison API

The API serves canonical product data with cross-retailer price comparisons.

### Core API Operations

**GET /products/{canonical_id}**
Returns a canonical product with all current retailer listings and prices.

**GET /products/compare?model={model}&brand={brand}**
Returns all canonical products matching the model/brand query with cross-retailer prices.

**GET /products/{canonical_id}/price-history**
Returns historical prices across all retailers for a given time range.

**POST /alerts**
Creates a price alert: notified when a specific canonical product drops below a target price at any retailer.

### API Response Shape

```json
{
  "canonical_id": "PRD-SONY-WH1000XM5-BLK",
  "brand": "Sony",
  "model": "WH-1000XM5",
  "variant": "Black",
  "listings": [
    {
      "retailer": "Store A",
      "price": 348.00,
      "currency": "USD",
      "url": "https://storea.com/sony-wh1000xm5",
      "in_stock": true,
      "last_updated": "2026-05-08T10:30:00Z"
    },
    {
      "retailer": "Store B",
      "price": 312.00,
      "currency": "USD",
      "url": "https://storeb.com/p/sony-wh1000xm5",
      "in_stock": true,
      "last_updated": "2026-05-08T10:30:00Z"
    }
  ],
  "price_summary": {
    "lowest": 299.00,
    "highest": 399.00,
    "average": 335.00,
    "last_lowest": "2025-11-29T00:00:00Z"
  }
}
```

---

## How Freshness Is Maintained

Price comparison is only useful when prices are current. Engines maintain freshness through:

| Strategy | Freshness | Cost |
|----------|-----------|------|
| Hourly crawling (all products) | < 1 hour | Very high |
| Daily crawling (all products) | < 24 hours | High |
| Priority crawling (high-traffic products) | Varies | Medium |
| On-demand crawling (requested products only) | First request delay | Low |
| Retailer API feeds | < 1 hour | Medium |

Most engines use a combination: daily full crawls for broad coverage, hourly priority crawls for top products, and on-demand crawling for long-tail products.

---

## How BuyWhere's Engine Is Designed

BuyWhere uses a layered crawling strategy:

1. **Broad coverage**: Scheduled crawls across major Singapore and US retailers on daily cycles
2. **Priority acceleration**: Products in active comparison flows get hourly price updates
3. **On-demand expansion**: New product requests trigger immediate crawl and normalisation
4. **GTIN-anchored matching**: GTIN matches provide deterministic cross-merchant identity
5. **Model-extracted matching**: For products without GTINs, NLP-based model extraction fills gaps
6. **Confidence-scored results**: Each comparison result carries a confidence score indicating match certainty

---

## Related Questions

- [What Is a Shopping Comparison Engine](/pages/what-is-shopping-comparison-engine)
- [What Is a Price Comparison API](/pages/what-is-price-comparison-api)
- [What Is Product Matching](/pages/what-is-product-matching)
- [What Is Real-Time Price Data](/pages/what-is-real-time-price-data)
