---
title: "What Is a Product Taxonomy? — Developer FAQ"
slug: "what-is-product-taxonomy"
description: "FAQ explaining what a product taxonomy is in e-commerce. Covers category hierarchies, taxonomy structures, product classification, Google product categories, and how BuyWhere uses product taxonomy for price comparison."
category: FAQ
tags:
  - "product taxonomy"
  - "product categorisation"
  - "e-commerce taxonomy"
  - "product category hierarchy"
  - "Google product category"
  - "product classification"
  - "category structure"
schema_type: Article
published: true
updated: 2026-05-08
---

# What Is a Product Taxonomy? — Developer FAQ

A product taxonomy is a hierarchical classification system that organises products into categories and subcategories. This FAQ covers what product taxonomies are, how they work, and how BuyWhere uses product taxonomy for accurate price comparison.

---

## What Is a Product Taxonomy?

A product taxonomy is a structured hierarchy that organises all products into categorical groupings:

```
Electronics
├── Audio
│   ├── Headphones
│   │   ├── Over-ear headphones
│   │   ├── On-ear headphones
│   │   └── In-ear headphones
│   └── Speakers
│       ├── Smart speakers
│       └── Portable speakers
├── Computing
│   ├── Laptops
│   │   ├── Ultrabooks
│   │   ├── Gaming laptops
│   │   └── Business laptops
│   └── Tablets
│       ├── Android tablets
│       └── iPads
```

Each product belongs to exactly one leaf category (the most specific level), but can be traced up through parent categories to the root.

Product taxonomies serve multiple purposes:
- **Navigation**: Users browse categories to find products
- **Classification**: Products are assigned to categories for organisation
- **Comparison**: Category membership enables comparison within and across categories
- **Advertising**: Product categories target ads to relevant audiences

---

## Why Does Product Taxonomy Matter for Price Comparison?

Product taxonomy directly affects price comparison accuracy:

### 1. Same-Product Comparison

A product like "Sony WH-1000XM5" belongs to multiple potential categories depending on the retailer:
- Electronics → Audio → Headphones → Over-ear headphones (BuyWhere)
- Electronics → Headphones → Noise-cancelling → Sony (Retailer A)
- Electronics → Audio & Video → Headphones → Sony (Retailer B)

If taxonomy is not normalised, the same product appears in different categories across retailers, making cross-retailer comparison inconsistent.

### 2. Category-Level Price Analysis

Price indices, averages, and trends are calculated at the category level. A well-structured taxonomy enables:
- "Average price of over-ear headphones in May 2026"
- "Price trend for gaming laptops over the past 6 months"
- "Lowest-priced category for electronics this Black Friday"

### 3. Search and Discovery

Product taxonomy powers faceted search and category-based filtering:
- "Show me headphones under $200"
- "Filter tablets by brand and screen size"

Accurate taxonomy makes these filters work correctly.

---

## What Are the Major Product Taxonomy Standards?

### Google Product Categories (Google Taxonomy)

Google maintains a standardised product category taxonomy used for Shopping ads and merchant centre feeds:

```
166  Electronics > Audio > Headphones
207  Electronics > Audio > Headphones > Over-Ear
208  Electronics > Audio > Headphones > On-Ear
209  Electronics > Audio > Headphones > In-Ear
```

The Google Taxonomy is the most widely used standard for product classification in e-commerce. BuyWhere uses Google Taxonomy IDs as the category identifier in its canonical product model.

Benefits:
- Standardised across the industry
- Used by Google Shopping, Facebook Catalog, and many other platforms
- Comprehensive coverage of product types

Limitations:
- Does not cover all local market nuances
- Some categories are too broad or too specific
- Does not account for product variants (colour, size)

### UNSPSC (United Nations Standard Products and Services Code)

UNSPSC is a taxonomy used primarily in B2B and procurement contexts:

```
45121500  Audio Visual Equipment
45121506  Personal Multimedia Players
45121507  Headphones
```

UNSPSC is organised by commodity rather than end-consumer use case, making it less intuitive for retail but useful for B2B procurement.

### Custom Retailer Taxonomies

Large retailers (Amazon, Walmart, Target) maintain their own taxonomies optimised for their product assortment and navigation needs. These taxonomies are proprietary and differ significantly from each other.

---

## How Does Product Classification Work?

Product classification is the process of assigning a product to the correct category in a taxonomy.

### Rule-Based Classification

Classification rules assign products based on attributes:
```
IF brand IN ["Sony", "Bose", "Apple", "Sennheiser"] AND product_type = "audio" AND form_factor = "over-ear":
    category = "Electronics > Audio > Headphones > Over-Ear"
```

Rule-based classification is fast and deterministic but requires maintaining rules as product types evolve.

### Machine Learning Classification

ML classifiers learn from labelled examples:
- Train on products with known category assignments
- Predict category for new products based on title, description, and attributes

ML classification handles more products with less manual rule maintenance but requires training data and can make errors on ambiguous products.

### Hybrid Classification

Most production systems combine rules and ML:
- High-confidence ML predictions are accepted automatically
- Low-confidence predictions are routed to human reviewers
- Human decisions update the training data

---

## How Does BuyWhere Use Product Taxonomy?

BuyWhere uses product taxonomy in several ways:

### Canonical Category Assignment

Each canonical product is assigned to exactly one canonical category using Google Taxonomy IDs:

```
Canonical Product: Sony WH-1000XM5
Canonical Category: 207 (Electronics > Audio > Headphones > Over-Ear)
```

This ensures consistent category assignment across all retailer listings for the same product.

### Category Price Indices

BuyWhere calculates price indices at the category level:
- Average price for category 207 across all tracked products
- Price trend for category 207 over time
- Lowest-priced product in category 207

### Category Navigation

Product taxonomy powers category-based browsing and filtering on BuyWhere.

### Taxonomy Mapping

Different retailers use different taxonomies. BuyWhere maps retailer categories to the canonical Google Taxonomy:

| Retailer Category | BuyWhere Canonical Category |
|------------------|---------------------------|
| "Noise Cancelling Headphones" | 207 (Electronics > Audio > Headphones > Over-Ear) |
| "Wireless Headphones" | 207 |
| "Audiophile Headphones" | 207 |

---

## What Is a Product Category?

A product category is a node in the taxonomy hierarchy. Categories can be:

| Term | Meaning |
|------|---------|
| **Root category** | The top level of the hierarchy (e.g., "Electronics") |
| **Parent category** | A category one level above another |
| **Child category** | A category one level below another |
| **Sibling category** | Categories sharing the same parent |
| **Leaf category** | The most specific category (no children) |
| **Breadcrumb** | The full path from root to leaf (Electronics > Audio > Headphones > Over-Ear) |

---

## What Is Category Matching?

Category matching is the process of aligning product categories across different taxonomy systems.

For example, mapping retailer categories to Google Taxonomy:

| Retailer | Retailer Category | Google Taxonomy ID |
|----------|-----------------|-------------------|
| Store A | "Wireless NC Headphones" | 207 |
| Store B | "On-Ear Headphones" | 208 |
| Store C | "Sony Headphones" | 207 |

Category matching enables:
- Normalising product data from multiple retailers
- Accurate cross-retailer price comparison at the category level
- Consistent price index calculations

---

## What Are the Challenges in Product Taxonomy?

### 1. Taxonomy Fragmentation

No single taxonomy is universally used. Different retailers, platforms, and regions use different classification systems. Mapping between these systems is complex and requires ongoing maintenance.

### 2. Multi-Category Products

Some products fit multiple categories:
- A "2-in-1 laptop" could be "Laptops" or "Tablets"
- A "smart speaker with screen" could be "Smart Speakers" or "Smart Displays"

Multi-category ambiguity affects comparison accuracy.

### 3. Evolving Product Types

New product types emerge that do not fit existing categories:
- "Wireless earbuds with heart rate monitoring" — where does this go?
- "Smart ring" — Electronics? Wearables? Fashion?

Taxonomies must evolve to accommodate new product types.

### 4. Regional Variation

Product categories vary by market:
- "Rice cookers" might be "Kitchen Appliances" in one market and "Home & Garden" in another
- "Gaming chairs" might be "Furniture" or "Gaming Equipment"

Global platforms must handle regional taxonomy variation.

---

## How Does Taxonomy Support Price Comparison?

Taxonomy enables several key price comparison features:

### 1. Category-Level Comparison

Users can compare average prices across products within a category, not just individual products.

### 2. Price Index Calculation

Category price indices (as in [What Is a Price Index](/pages/what-is-a-price-index)) are calculated using products grouped by category.

### 3. Related Product Comparison

Taxonomy proximity indicates product similarity. Products in the same leaf category are close substitutes; products in different branches are less related.

### 4. Assortment Analysis

Retailer assortment can be analysed by category:
- Which categories does each retailer cover?
- Which categories are underserved (few products, high prices)?
- Where is competition most intense?

---

## Related Questions

- [What Is a Price Index](/pages/what-is-a-price-index)
- [What Is Product Matching](/pages/what-is-product-matching)
- [What Is Product Normalisation](/pages/what-is-product-normalisation)
- [How Price Tracking Works](/pages/how-price-tracking-works)
