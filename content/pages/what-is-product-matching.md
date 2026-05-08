---
title: "What Is Product Matching? — Developer FAQ"
slug: "what-is-product-matching"
description: "FAQ explaining what product matching is in the context of price comparison and e-commerce. Covers GTIN matching, model extraction, variant resolution, confidence scoring, and how BuyWhere handles product matching."
category: FAQ
tags:
  - "product matching"
  - "what is product matching"
  - "GTIN matching"
  - "product normalisation"
  - "SKU matching"
  - "cross-merchant price data"
  - "price comparison"
  - "developer commerce API"
schema_type: Article
published: true
updated: 2026-05-08
---

# What Is Product Matching? — Developer FAQ

Product matching is the process of identifying when two listings from different retailers describe the same physical product. It is the technical foundation that makes cross-merchant price comparison possible. This FAQ covers how product matching works, why it is hard, and how BuyWhere handles it.

---

## What Is Product Matching?

Product matching (also called product normalisation or deduplication) is the process of recognising when listings from different retailers refer to the same physical product, even when they use completely different names, SKUs, or descriptions.

For example, these four listings all describe the same product:

| Retailer | Product Name |
|----------|-------------|
| Store A | Sony WH-1000XM5 Wireless Noise Cancelling Headphones — Black |
| Store B | Sony 1000XM5 Headphone Over-Ear Bluetooth - Matte Black |
| Store C | Sony WH1000XM5B.CE7 |
| Store D | Sony Headphones WH-1000XM5 Series - Black |

A product matching system recognises these as the same product and groups them together, enabling accurate cross-retailer price comparison.

---

## Why Is Product Matching Hard?

Product matching is one of the hardest problems in e-commerce data. The challenges include:

### 1. Inconsistent Naming

Retailers use completely different names for the same product. There is no standard naming convention, so "Sony WH-1000XM5" might appear as "Sony WH1000XM5", "Sony 1000XM5", "Sony WH-1000XM5", or "SN WH1000XM5/B".

### 2. Missing GTINs

GTINs (Global Trade Item Numbers) are the gold standard for product matching — two listings with the same GTIN are the same product. But many retailers don't expose GTINs in their product pages, and some include incorrect GTINs.

### 3. Variant Confusion

The same product comes in variants (colour, size, storage capacity) that have different GTINs. "AirPods Pro White" and "AirPods Pro Black" are different products. Conflating variants produces inaccurate comparisons.

### 4. Bundle vs Standalone

A bundle listing ("Sony WH-1000XM5 + Carrying Case") is not the same product as the standalone listing. Bundle detection is a related but separate problem.

### 5. Data Quality Variation

Different retailers provide different levels of product data quality. Some provide structured feeds with GTINs; others provide only HTML pages with minimal markup.

---

## How Does Product Matching Work?

Modern product matching uses multiple signals in combination:

### 1. GTIN / UPC / EAN Matching

GTINs (Global Trade Item Numbers) are standardised 8-14 digit barcodes that uniquely identify a tradeable product. When GTINs are available and accurate, matching is unambiguous.

**Challenge**: Many retailers don't expose GTINs in their product pages. Others have incorrect GTINs.

### 2. Brand + Model Extraction

When GTINs are unavailable, systems extract brand and model information from product titles:

- **Brand extraction**: Recognising "Sony", "SONY", and "sony" as the same brand
- **Model extraction**: Recognising "WH-1000XM5", "WH1000XM5", and "1000XM5" as the same model

This requires handling:
- Case variations, hyphenation, spacing
- Common word removal ("wireless", "noise cancelling")
- Manufacturer abbreviation conventions

### 3. Category Context

The same model number can refer to different products in different categories. "Dyson V15" is a vacuum cleaner; the model number alone is ambiguous without category context.

### 4. Title Similarity

For products without reliable GTINs or extractable model numbers, text similarity algorithms compare titles to find likely matches using:

- Token overlap (splitting titles into words)
- Edit distance (Levenshtein distance)
- Embedding similarity (semantic vectors)

### 5. Image Similarity

Product images provide an additional matching signal. Two listings with different text but visually identical images are likely the same product.

---

## What Is Variant Resolution?

Variant resolution is the process of separating different variants of the same product (colour, size, storage) before comparison.

### Why Variants Matter

"AirPods Pro White" and "AirPods Pro Black" are different products with different GTINs and different prices. Conflating them produces comparison tables where a colour's price appears under a different colour listing.

### How It Works

Variant resolution extracts variant information (colour, size, storage) from titles and matches each variant to its correct canonical product:

- Colour variants → separate GTINs → separate comparison entries
- Size variants → separate GTINs → separate comparison entries
- Storage variants → separate GTINs → separate comparison entries

---

## What Is Confidence Scoring?

No product matching system is perfect. Confidence scoring indicates how certain the system is about a match.

| Confidence | Meaning |
|------------|---------|
| **High** | GTIN match — exact same product |
| **Medium** | Strong model match with variant alignment — very likely same product |
| **Low** | Title similarity only — possible match, review recommended |
| **Rejected** | Could not confidently match |

Low-confidence matches are typically excluded from comparison results or shown with a warning.

---

## What Is Bundle Detection?

Bundle detection identifies when a listing includes extras beyond the base product.

### Why Bundles Matter

A listing "Sony WH-1000XM5 + Carrying Case + Extra Ear Tips" is not the same product as the standalone "Sony WH-1000XM5". Comparing their prices directly is misleading.

### How It Works

Bundle detection uses:
- Keyword signals: "with", "+", "bundle", "pack"
- Price signals: a bundle priced only slightly higher than standalone suggests minimal extra value
- Component matching: if all bundle components can be matched to standalone products, it's likely a bundle

---

## How Does BuyWhere Handle Product Matching?

BuyWhere uses a multi-stage normalisation pipeline:

1. **GTIN extraction** — GTINs extracted from all available sources
2. **Model parsing** — NLP-based extraction identifies brand and model from inconsistent titles
3. **Variant resolution** — Colour, size, and storage variants separated
4. **Bundle detection** — Listings identified as bundles flagged
5. **Confidence scoring** — Each normalised product gets a match confidence score
6. **Cross-validation** — GTIN matches used to train model extraction accuracy

The result: BuyWhere comparison tables show the same actual product compared across retailers.

---

## Related Questions

- [What Is Product Normalisation](/pages/what-is-product-normalisation)
- [Why Price Comparison Tools Fail](/pages/why-price-comparison-tools-fail)
- [How Price Tracking Works](/pages/how-price-tracking-works)
