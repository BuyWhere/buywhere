---
title: "What Is a Product Identifier? — Developer FAQ"
slug: "what-is-a-product-identifier"
description: "FAQ explaining product identifiers in e-commerce. Covers GTIN, UPC, EAN, MPN, SKU, model number, and how BuyWhere uses them for product matching and normalisation."
category: FAQ
tags:
  - "product identifier"
  - "GTIN"
  - "UPC"
  - "EAN"
  - "MPN"
  - "SKU"
  - "model number"
  - "product matching"
schema_type: Article
published: true
updated: 2026-05-08
---

# What Is a Product Identifier? — Developer FAQ

Product identifiers are standardised codes that uniquely identify a product. This FAQ covers the major product identifier types, how they differ, and how BuyWhere uses them for product matching and normalisation.

---

## What Is a Product Identifier?

A product identifier is a unique code assigned to a product that distinguishes it from all other products. Different identifier systems exist for different purposes:

| Identifier | Full Name | Used By | Example |
|-----------|-----------|---------|---------|
| **GTIN** | Global Trade Item Number | Global (GS1) | `027242207509` |
| **UPC** | Universal Product Code | US/Canada (GS1) | `012345678905` |
| **EAN** | European Article Number | Europe (GS1) | `4006381333931` |
| **MPN** | Manufacturer Part Number | Manufacturers | `WH1000XM5B` |
| **SKU** | Stock Keeping Unit | Retailers | `AUD-1000XM5-BLK` |
| **Model Number** | Model Number | Manufacturers | `WH-1000XM5` |

Each identifier serves a different purpose and is managed by different organisations.

---

## GTIN — Global Trade Item Number

The GTIN is the global standard for product identification managed by GS1. A GTIN uniquely identifies a specific tradeable product at a specific point of packaging.

### GTIN Structure

GTINs come in four lengths:

| Format | Digits | Usage |
|--------|--------|-------|
| GTIN-8 | 8 | For small packaging |
| GTIN-12 | 12 | UPC (United States) |
| GTIN-13 | 13 | EAN (Europe) |
| GTIN-14 | 14 | Shipping containers |

### How GTINs Are Assigned

GS1 allocates company prefixes to manufacturers. The manufacturer assigns the remaining digits to each product. The final digit is a check digit calculated using the GS1 algorithm.

```
GTIN: 012345678905
      ├──┘ └──┘ └──┘
      │     │     └─── Item reference (assigned by manufacturer)
      │     └─────── Company prefix (assigned by GS1)
      └──────────────indicator digit (for GTIN-14)
```

### GTIN and Product Variants

Each distinct product variant (different colour, size, flavour) should have its own GTIN. However, in practice:
- Some manufacturers use the same GTIN for multiple colour variants
- Some use different GTINs for each colour
- There is no universal standard for variant GTINs

This means GTIN matching alone is not always sufficient for variant resolution.

---

## UPC — Universal Product Code

The UPC is the 12-digit GTIN used primarily in the United States and Canada. It is the barcode format scanned at retail point of sale.

### UPC-A vs. UPC-E

- **UPC-A**: Standard 12-digit UPC
- **UPC-E**: 8-digit UPC (zero-suppressed version of UPC-A)

### UPC Check Digit

The final digit of a UPC is a check digit. Valid UPCs pass the check digit algorithm:

```
Step 1: Sum odd-position digits (positions 1,3,5,7,9,11) × 3
Step 2: Add even-position digits (positions 2,4,6,8,10)
Step 3: Total mod 10 = 0? If not, the UPC is invalid
```

---

## EAN — European Article Number

The EAN is the 13-digit GTIN used in Europe and most of the world (outside North America).

The EAN-13 is essentially a GTIN-13. The first 12 digits encode country and manufacturer information; the final digit is a check digit.

JAN (Japanese Article Numbers) use the same 13-digit structure as EAN and are compatible with the same system.

---

## MPN — Manufacturer Part Number

The MPN is a code assigned by the manufacturer to identify a specific product model. MPNs are not part of a global standard — each manufacturer uses their own format.

### MPN Examples

| Manufacturer | Product | MPN |
|-------------|---------|-----|
| Sony | WH-1000XM5 Headphones | `WH1000XM5B` |
| Apple | iPhone 15 Pro 256GB | `MU6A3LL/A` |
| Samsung | Galaxy S24 Ultra | `SM-S928BZKFXSG` |

### MPN Challenges

- **Format variation**: MPN formats vary dramatically by manufacturer. Sony uses one format, Samsung another, Apple another.
- **No check digit**: MPNs have no built-in validation mechanism.
- **Case sensitivity**: Some MPNs are case-insensitive; others treat letters and numbers as distinct.
- **Overloading**: The same MPN sometimes refers to different products in different contexts.
- **Internal use**: Some MPNs are for internal inventory only and never appear on product packaging.

---

## SKU — Stock Keeping Unit

A SKU is a retailer-assigned identifier for inventory management. SKUs are internal to each retailer — the same product has a different SKU at each retailer.

### SKU Examples

| Retailer | Product | SKU |
|----------|---------|-----|
| Amazon | Sony WH-1000XM5 | `B09VJSKXWN` |
| Best Buy | Sony WH-1000XM5 | `6505727` |
| Walmart | Sony WH-1000XM5 | `101834567` |

### SKU Limitations

- **Non-standard**: No universal SKU format; each retailer invents their own
- **Non-portable**: A SKU at one retailer has no meaning at another
- **Version changes**: Retailers may change SKUs when product versions change
- **No external reference**: SKUs cannot be looked up outside the retailer's system

SKUs are useful for internal inventory but cannot be used for cross-retailer product matching.

---

## Model Number

A model number is a manufacturer-assigned code identifying a product model. Unlike MPNs (which may include variant information), model numbers typically identify the base product.

### Model Number vs. MPN

In many cases, the model number and MPN are the same. But they can differ:

| Product | Model Number | MPN |
|---------|-------------|-----|
| Sony WH-1000XM5 | WH-1000XM5 | WH1000XM5B |
| MacBook Pro 14" | A2442 | `MKGT3LL/A` |

The model number identifies the product design; the MPN may encode additional variant or regional information.

### Model Number Extraction

Since model numbers have no standard format, extracting them from product titles requires brand-specific patterns:

```
"Sony WH-1000XM5 Wireless NC Headphones" → model: WH-1000XM5
"Bose QuietComfort Ultra Headphones"     → model: QuietComfort Ultra
"Apple MacBook Pro 14-inch M3 Pro"      → model: MacBook Pro 14-inch M3 Pro
```

Model extraction is one of the core challenges in product normalisation.

---

## How BuyWhere Uses Product Identifiers

BuyWhere uses multiple identifier types in combination for accurate product matching:

### Identifier Priority

| Priority | Identifier | Confidence |
|----------|-----------|------------|
| 1 | GTIN | Highest — global standard, check-digit validated |
| 2 | MPN + Brand | High — manufacturer-assigned, model-specific |
| 3 | Model Number + Category | Medium — requires category context to disambiguate |
| 4 | Title Similarity | Lower — fuzzy matching on product titles |

### GTIN Matching

GTINs are the gold standard for product matching. Two listings with the same GTIN are the same physical product (with the caveat of variant handling).

BuyWhere:
1. Extracts GTINs from all retailer listings
2. Validates GTINs using the GS1 check digit algorithm
3. Invalid GTINs are discarded
4. Valid GTINs are used as the primary match key

### MPN Matching

For products without reliable GTINs, MPN matching supplements the pipeline:

1. Extract MPN and brand from retailer titles
2. Match listings with the same MPN + brand
3. Apply variant resolution to separate colours, sizes, and storage variants

### Model Number Extraction

For products without GTINs or MPNs, model number extraction identifies the model:

1. Apply brand-specific patterns to extract the model string
2. Use category context to disambiguate models that appear in multiple product lines
3. Match listings with the same brand + model

### Title Similarity

For edge cases without GTIN, MPN, or extractable model:

1. Tokenise product titles (split into words)
2. Remove common words (brand, colour, size descriptors)
3. Calculate title similarity using edit distance or embedding similarity
4. Match listings above the similarity threshold

---

## Identifier Normalisation

Identifiers are normalised before matching to handle format variations:

### GTIN Normalisation

- Strip leading zeros
- Convert between GTIN-12, GTIN-13, and GTIN-14 by adding/removing leading zeros
- Validate check digit and discard invalid GTINs

### MPN Normalisation

- Uppercase all letters
- Remove spaces, hyphens, dashes
- Standardise common abbreviations

### Model Number Normalisation

- Lowercase
- Remove spaces
- Standardise hyphenation patterns
- Handle brand-specific formatting quirks

---

## Product Identifier Limitations

### GTIN Limitations

- **Missing GTINs**: Many retailers do not expose GTINs in their product pages
- **Incorrect GTINs**: Some retailers include wrong GTINs (mispaste, wrong product)
- **Variant GTIN ambiguity**: Some manufacturers use the same GTIN for multiple variants
- **Bundles**: A bundle of two products may have a distinct GTIN not matching either component

### MPN Limitations

- **Format variation**: No standard MPN format; extraction is brand-specific
- **Global uniqueness**: MPNs are not globally unique — the same MPN may appear across different manufacturer systems
- **Ambiguity without brand**: MPN alone is ambiguous without the brand context

### SKU Limitations

- **Non-portable**: SKUs cannot be used for cross-retailer matching
- **No external reference**: SKUs cannot be looked up outside the retailer's system
- **Format instability**: Retailers change SKUs without notice

---

## Related Questions

- [What Is Product Matching](/pages/what-is-product-matching)
- [What Is Product Normalisation](/pages/what-is-product-normalisation)
- [What Is a Canonical Product](/pages/what-is-canonical-product)
- [What Is a Product Feed](/pages/what-is-a-product-feed)
