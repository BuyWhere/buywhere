---
title: "What Is a Canonical Product? — Developer FAQ"
slug: "what-is-canonical-product"
description: "FAQ explaining what a canonical product is in price comparison systems. Covers product identity, canonical form, SKU normalisation, and how BuyWhere resolves multiple retailer listings into a single product record."
category: FAQ
tags:
  - "canonical product"
  - "product identity"
  - "product ID"
  - "SKU normalisation"
  - "product canonical form"
  - "cross-merchant product matching"
  - "developer commerce API"
schema_type: Article
published: true
updated: 2026-05-08
---

# What Is a Canonical Product? — Developer FAQ

A canonical product is the single, authoritative representation of a physical product after all retailer variations have been resolved. This FAQ covers what canonical products are, how they are created, and why they matter for price comparison.

---

## What Is a Canonical Product?

A canonical product is the normalised, de-duplicated form of a product after cross-merchant listings have been matched and merged.

Each retailer listing for "Sony WH-1000XM5" (regardless of how the title is phrased, what GTIN is used, or which variant is described) maps to one canonical product record.

| Canonical Product | Canonical ID | Example Retailer Listings |
|-------------------|-------------|--------------------------|
| Sony WH-1000XM5 | PRD-SONY-WH1000XM5-BLK | Store A, Store B, Store C... |
| Apple AirPods Pro 2 | PRD-APPLE-APP2-WHT | Store A, Store B, Store C... |

The canonical product acts as the anchor for price comparison — all retailer prices for the same physical product attach to the same canonical record.

---

## Why Does Canonical Form Matter?

Without canonical products, a price comparison table would show:

| Retailer | Product | Price |
|----------|---------|-------|
| Store A | Sony WH-1000XM5 Wireless NC Headphones - Black | $348 |
| Store B | Sony 1000XM5 Headphone Over-Ear Bluetooth Matte Black | $312 |
| Store C | Sony WH1000XM5B.CE7 | $299 |

This is three different products by the table's data — even though all three listings describe the same physical item. Users see three rows with different prices and assume they are comparing the same product across three retailers. The actual lowest price appears hidden.

With canonical products, the same comparison looks like:

| Retailer | Product | Price |
|----------|---------|-------|
| Store A | Sony WH-1000XM5 (Black) | $348 |
| Store B | Sony WH-1000XM5 (Black) | $312 |
| Store C | Sony WH-1000XM5 (Black) | $299 |

Canonical form enables honest cross-retailer price comparison by ensuring every row represents the same actual product.

---

## How Is a Canonical Product Created?

Canonical product creation is a pipeline:

```
Retailer Listing → Extraction → Matching → Canonicalisation → Canonical Product Record
```

### Step 1: Data Extraction

Extract structured fields from each retailer listing:
- Product name / title
- Brand and manufacturer
- Model number
- GTIN / UPC / EAN
- Variant attributes (colour, size, storage)
- Price and currency

### Step 2: Product Matching

Group listings that describe the same physical product using:
- **GTIN matching**: listings with identical GTINs → same product
- **Model + variant matching**: matching brand + model + variant attributes → same product
- **Title similarity**: for listings without GTINs, fuzzy title matching fills gaps

### Step 3: Canonicalisation

For each matched group:
1. **Select canonical brand**: normalised brand name
2. **Select canonical model**: standardised model string
3. **Select canonical variant**: resolved variant attributes (colour, size, storage)
4. **Generate canonical ID**: stable identifier derived from canonical attributes
5. **Attach all matching retailer listings**: each listing references the canonical product ID

---

## What Is a Canonical ID?

A canonical ID is a stable, deterministic identifier for a canonical product. The same physical product always generates the same canonical ID regardless of which retailer listing was used as the source.

Canonical IDs are typically derived from:

- **Brand + model + variant hash**: `hash("sony" + "wh-1000xm5" + "black")` → `PRD-SONY-WH1000XM5-BLK`
- **GTIN prefix**: if a reliable GTIN is available, the canonical ID references it
- **Category + model number**: for products without GTINs, category context disambiguates model numbers that appear across multiple product lines

The key property: two independent crawler runs producing listings for the same product generate the same canonical ID, enabling reliable price history tracking.

---

## Canonical Products vs. SKUs vs. Product IDs

These terms overlap but have distinct meanings:

| Term | Scope | Owner | Example |
|------|-------|-------|---------|
| **SKU** | Retailer-specific | Each retailer | `WH1000XM5-BLK-001` |
| **Product ID** | Retailer-specific | Each retailer | Internal database ID |
| **GTIN** | Global (intended) | GS1 assigned | `027242207509` |
| **Canonical Product** | Cross-merchant | BuyWhere | `PRD-SONY-WH1000XM5-BLK` |

SKUs and product IDs are retailer-internal identifiers that don't cross retailer boundaries. A "SKU" at Store A has no meaning at Store B. The canonical product is BuyWhere's cross-retailer identity layer on top of these.

---

## How Does Variant Canonicalisation Work?

The same product model comes in multiple variants (colour, storage, size). Each variant has a distinct GTIN and potentially different prices.

Variant canonicalisation ensures:

- "Sony WH-1000XM5 Black" and "Sony WH-1000XM5 Silver" are separate canonical products
- Each canonical product tracks only prices for its specific variant
- Price history for the Black variant does not mix with the Silver variant

This requires extracting variant attributes from retailer titles that may describe them inconsistently:

| Retailer Title | Extracted Variant | Canonical ID |
|---------------|-------------------|--------------|
| "Sony WH-1000XM5 Wireless - Matte Black" | Colour: Black | PRD-SONY-WH1000XM5-BLK |
| "Sony WH-1000XM5 Wireless Over-Ear - Silver" | Colour: Silver | PRD-SONY-WH1000XM5-SLV |
| "Sony WH1000XM5B.CE7 (Black)" | Colour: Black | PRD-SONY-WH1000XM5-BLK |

---

## How Are Bundles Handled in Canonical Form?

Bundles are canonicalised separately from the base product:

- **Base product canonical**: `PRD-SONY-WH1000XM5-BLK` — the headphones alone
- **Bundle canonical**: `BUNDLE-SONY-WH1000XM5-BLK+CASE` — headphones + case

Bundle detection flags listings that include extra components. The bundle canonical product is separate from the base product canonical, ensuring:
- Price comparison for the base product does not include bundle listings
- Users specifically looking for bundles can find bundle comparisons

---

## What Is the Relationship Between Canonical Products and Price Comparison?

Canonical products enable meaningful price comparison:

1. **Same product, multiple prices**: all retailer prices for `PRD-SONY-WH1000XM5-BLK` are comparable
2. **Price history**: prices tracked over time for the same canonical product
3. **Price alerts**: alert triggers when any retailer price for this canonical product drops
4. **Price drops**: identified relative to each canonical product's own price range

Without canonical products, a price table compares apples to oranges. With canonical products, it compares the same product across retailers.

---

## Related Questions

- [What Is Product Matching](/pages/what-is-product-matching)
- [What Is Product Normalisation](/pages/what-is-product-normalisation)
- [How Price Tracking Works](/pages/how-price-tracking-works)
