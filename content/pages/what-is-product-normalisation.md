---
title: "What Is Product Normalisation? The Foundation of Accurate Price Comparison"
slug: "what-is-product-normalisation"
description: "Developer guide explaining product normalisation — how price comparison systems match the same product across different retailers with different names, SKUs, and descriptions. Covers GTIN matching, NLP-based model extraction, variant resolution, and bundle detection."
category: Blog
tags:
  - "product normalisation"
  - "product matching"
  - "price comparison"
  - "GTIN matching"
  - "SKU matching"
  - "cross-merchant price data"
  - "product deduplication"
  - "developer commerce API"
  - "BuyWhere normalisation"
schema_type: Article
published: true
updated: 2026-05-08
---

# What Is Product Normalisation? The Foundation of Accurate Price Comparison

Product normalisation is the process of taking product listings from different retailers — each with their own naming conventions, SKU systems, and descriptions — and converting them into a canonical (standardised) form that enables accurate comparison.

Without normalisation, a price comparison table shows different products with similar names. With normalisation, it shows the same product compared across retailers.

---

## The Problem: One Product, Many Names

Retailers describe the same product in completely different ways. Here is the same product across five retailers:

| Retailer | Product Name |
|----------|-------------|
| Store A | Sony WH-1000XM5 Wireless Noise Cancelling Headphones — Black |
| Store B | Sony 1000XM5 Headphone Over-Ear Bluetooth Noise Cancelling - Matte Black |
| Store C | Sony WH1000XM5B.CE7 |
| Store D | Sony Headphones WH-1000XM5 Series - Black (Wireless/ANC) |
| Store E | Sony WH-1000XM5 ANC Over-Ear Headphones - Black |

A naive comparison system that matches by exact title string would treat these as five different products. A normalised system recognises they all refer to the same item: the Sony WH-1000XM5 in black.

---

## Why Normalisation Matters for Price Comparison

Without correct normalisation, price comparison fails in three ways:

### 1. False Matches

Two different products with similar names get matched. A comparison table might show "Store A at $50" and "Store B at $45" — but Store B's listing is actually a different (and genuinely cheaper) model. The user buys Store A's product expecting a deal, then finds they bought the wrong item.

### 2. Missed Matches

The same product appears multiple times in a comparison because the system doesn't recognise it as identical. A user sees the same product listed at five different prices from five different retailers and has no way to know they are looking at the same item.

### 3. Variant Confusion

The same product in different colours or sizes gets conflated. A user looking for the white AirPods Pro sees the black AirPods Pro price and wonders why the "same product" costs different amounts at different stores — when it doesn't.

---

## How Product Normalisation Works

Modern normalisation uses a layered approach, applying multiple matching techniques in sequence.

### Layer 1: GTIN / UPC / EAN Matching

The gold standard. GTINs (Global Trade Item Numbers) are 8-14 digit barcodes that uniquely identify a tradeable product globally. Two listings with the same GTIN are the same product — no ambiguity.

GTINs appear in:
- Product barcodes (scannable)
- Retailer product page HTML (sometimes)
- Retailer product feeds and APIs (sometimes)
- Google Merchant Center data (for retailers using it)

**Challenge**: Many retailers do not expose GTINs in their product pages. Others have incorrect GTINs. A normalisation system cannot rely solely on GTIN matching.

### Layer 2: Brand + Model Extraction

When GTINs are unavailable, the system extracts brand and model information from the product title.

For "Sony WH-1000XM5 Wireless Noise Cancelling Headphones — Black":
- **Brand**: Sony
- **Model**: WH-1000XM5
- **Variant**: Black

Brand and model extraction requires handling:
- Case variations: "SONY", "Sony", "sony" all mean the same brand
- Model formats: "WH-1000XM5", "WH1000XM5", "1000XM5" all refer to the same model
- Common word removal: "wireless", "noise cancelling", "over-ear" describe the product but aren't part of the model identifier
- Hyphen and space variations: model numbers are sometimes written with hyphens, sometimes without

### Layer 3: Category Context

Model numbers alone can be ambiguous. "Dyson V15" refers to different products in different categories (vacuum cleaners, hair dryers, air purifiers).

Category information disambiguates by narrowing the universe of possible matches. A listing in the "Vacuum Cleaners" category is matched against vacuum cleaner models, not hair dryers.

### Layer 4: Title Similarity

For products without reliable GTINs or extractable model numbers, title similarity algorithms compare product names to find likely matches.

Techniques include:
- **Token overlap**: Splitting titles into words and comparing the overlap in word sets
- **Edit distance**: Measuring how many character changes turn one string into another (Levenshtein distance)
- **Embedding similarity**: Converting titles to semantic vectors and measuring cosine similarity

Title similarity works best as a secondary signal after GTIN and model extraction fail.

### Layer 5: Image Similarity

Product images provide an additional matching signal. Two listings with different text descriptions but visually identical product photos are likely the same product.

Image similarity is computationally expensive and typically used as a tiebreaker when text-based signals are ambiguous.

---

## Handling Variants

Products of the same model come in variants (colour, size, storage capacity) that must be matched separately.

### Colour Variants

"AirPods Pro White" and "AirPods Pro Black" are different products with different GTINs. Conflating them produces incorrect comparison tables where a colour's price appears under the wrong listing.

A normalisation system must extract the colour variant and treat each colour as a separate canonical product.

### Size Variants

A "Nike Air Max size 9" and "Nike Air Max size 10" are different products — they have different GTINs. Size must be extracted and matched separately.

### Storage Variants

"iPhone 15 Pro 128GB" and "iPhone 15 Pro 256GB" have different GTINs and different prices. Storage capacity must be extracted and each variant matched independently.

### Bundle Variants

Some listings bundle a product with accessories (case, charger, extra ear tips). These bundles have different GTINs from the standalone product and should not be compared directly.

---

## Bundle Detection

Bundle detection identifies when a listing includes extra items beyond the base product.

A bundle listing:
- "Sony WH-1000XM5 + Carrying Case + Extra Ear Tips"
- "Apple AirPods Pro 2nd Gen with MagSafe Charging Case"

These are not the same product as the standalone listing and should not appear in the same comparison table without a note explaining the bundle contents.

Bundle detection uses:
- Keyword signals: "with", "+", "bundle", "pack"
- Price signals: a bundle priced only slightly higher than the standalone suggests the extras have minimal value
- Component matching: if the bundle's components can all be matched to standalone products, it's likely a bundle

---

## Confidence Scoring

No normalisation system is perfect. A confidence score indicates how certain the system is about a match.

| Confidence | Meaning |
|------------|---------|
| **High** | GTIN match — exact same product |
| **Medium** | Strong model match with variant alignment — very likely same product |
| **Low** | Title similarity only — possible match, requires human review |
| **Rejected** | Not matched — product appears in database but couldn't be confidently linked |

Low-confidence matches are typically excluded from comparison tables or shown with a warning that the match may not be accurate.

---

## How BuyWhere Does Normalisation

BuyWhere normalises products through a multi-stage pipeline:

1. **GTIN extraction** — GTINs are extracted from all available sources (product pages, feeds, Google Merchant Center data)
2. **Model parsing** — NLP-based extraction identifies brand names and model numbers from inconsistent title formats
3. **Variant resolution** — Colour, size, and storage variants are extracted and separated
4. **Bundle detection** — Listings identified as bundles are flagged
5. **Confidence scoring** — Each normalised product receives a match confidence score
6. **Cross-validation** — GTIN matches are used to train and improve model extraction; model matches are cross-validated against GTINs where available

The result: BuyWhere comparison tables show the same actual product compared across retailers — not similar products that happen to share keywords.

---

## Why Retailer APIs Don't Solve This

Retailer APIs (Amazon PA-API, Walmart API, Shopify Storefront API) only serve data from a single retailer. They don't need to match products across retailers — and they have no incentive to invest in cross-retailer normalisation.

This is why cross-merchant price comparison requires an independent normalisation layer: no single retailer benefits from building the infrastructure to compare their prices against competitors.

---

## Related Guides

- [Why Price Comparison Tools Fail](/pages/why-price-comparison-tools-fail) — Product matching failures in practice
- [Cross-Merchant Price Data Explained](/pages/cross-merchant-price-data) — The data layer that depends on normalisation
- [How Price Tracking Works](/pages/how-price-tracking-works) — The data collection pipeline
