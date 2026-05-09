---
title: "What Is MAP Pricing? — Developer FAQ"
slug: "what-is-map-pricing"
description: "FAQ explaining MAP (Minimum Advertised Price) pricing in e-commerce. Covers MAP policy enforcement, MAP monitoring, consequences of MAP violations, and how BuyWhere supports MAP price intelligence."
category: FAQ
tags:
  - "MAP pricing"
  - "minimum advertised price"
  - "MAP policy enforcement"
  - "MAP monitoring"
  - "price policy compliance"
  - "manufacturer pricing policy"
  - "retail price maintenance"
schema_type: Article
published: true
updated: 2026-05-08
---

# What Is MAP Pricing? — Developer FAQ

MAP (Minimum Advertised Price) is a pricing policy set by manufacturers or brand owners that specifies the lowest price at which their products can be advertised by retailers. This FAQ covers how MAP pricing works, how it is enforced, and how BuyWhere supports MAP price intelligence.

---

## What Is MAP Pricing?

MAP (Minimum Advertised Price) is a contractual pricing policy between a manufacturer (or brand owner) and its retail channel partners.

Under a MAP policy:

- The manufacturer specifies the lowest price retailers may advertise for a product
- This applies to advertised prices only (on websites, in ads, in catalogues)
- The actual transaction price (what a customer ultimately pays) can be below MAP
- MAP is enforced through retailer agreements and monitoring

### Example of MAP

```
Manufacturer: Sony
Product: Sony WH-1000XM5
MAP: $299

Retailer A advertises at $349 ✓ (above MAP)
Retailer B advertises at $299 ✓ (at MAP)
Retailer C advertises at $279 ✗ (below MAP — violates MAP)
```

In this example, Retailer C's advertised price violates the MAP agreement. However, Retailer C can still sell the product at $279 at checkout — just not advertise it at that price.

---

## Why Do Manufacturers Use MAP?

MAP policies protect the brand's positioning and retail channel:

### 1. Brand Perception

If a premium brand's products are advertised at deep discounts, it damages the brand's premium perception. A $399 headphone advertised at $199 is no longer perceived as premium.

MAP prevents this by ensuring advertised prices do not fall below a threshold that would undermine brand positioning.

### 2. Retail Channel Relationships

Manufacturers invest in retail partnerships — co-op advertising, shelf space, training. If a retailer advertises a manufacturer's product below cost or at minimal margin, it:
- Undermines other retailers who cannot compete
- Creates channel conflict
- May cause retailers to drop the product entirely

MAP protects all retail partners from destructive price competition.

### 3. Preventing the "Race to the Bottom"

Without MAP, aggressive retailers could advertise products at minimal margins, forcing all retailers into a price war. MAP prevents this.

---

## How Is MAP Enforced?

MAP enforcement is contractual, not legal. Manufacturers enforce MAP through:

### 1. Retailer Agreements

Retailers sign MAP agreements as a condition of being an authorised reseller. The agreement specifies:
- The MAP price for each product
- Consequences of violations
- Enforcement procedures

### 2. Monitoring

Manufacturers (or third-party services) monitor advertised prices across all authorised retailers. Monitoring methods:
- Web scraping of retailer product pages
- Feed monitoring for advertised prices
- Manual inspection of advertising materials

### 3. Consequences of Violation

MAP violations typically escalate:

| Violation | Consequence |
|-----------|-------------|
| First violation | Warning letter |
| Second violation | Required to advertise at MAP for a period |
| Repeated violations | Loss of authorised reseller status |
| Severe violations | Legal action for breach of contract |

---

## MAP vs. MSRP

MAP and MSRP (Manufacturer's Suggested Retail Price) are often confused but are different:

| | MAP | MSRP |
|-|-----|------|
| **Definition** | Minimum advertised price | Suggested retail price |
| **Enforcement** | Contractual, enforceable | Advisory only |
| **Binding** | Legally binding if in contract | Not legally binding |
| **Purpose** | Prevent advertised price wars | Guide retailers on pricing |

A retailer can advertise below MSRP (though this may violate MAP). A retailer cannot advertise below MAP (this is a breach of contract).

---

## What Is MAP Monitoring?

MAP monitoring is the practice of systematically tracking advertised prices to detect MAP violations.

### How MAP Monitoring Works

```
Manufacturer's MAP List
        │
        ▼
Monitored Retailers ──► Web Scraper ──► Price Extractor ──► MAP Comparison Engine
                                                      │
                                                      ▼
                                               Violation Alert
                                                      │
                                                      ▼
                                              Retailer Enforcement
```

### MAP Monitoring Data

A MAP monitoring system captures:

| Field | Description |
|-------|-------------|
| `retailer` | Retailer name |
| `product_id` | Manufacturer's product ID |
| `advertised_price` | Price as advertised |
| `map_price` | MAP threshold |
| `map_violation` | Boolean: is advertised price below MAP? |
| `recorded_at` | Timestamp of observation |
| `page_url` | URL where price was observed |

### MAP Monitoring Challenges

- **Price display variation**: Some retailers show price after login, making monitoring difficult
- **Dynamic pricing**: Prices change frequently; monitoring must capture the advertised price at a point in time
- **Promotional pricing**: MAP policies often have exceptions for short-term promotions

---

## What Is a MAP Violation?

A MAP violation occurs when a retailer advertises a product below the MAP price.

### Types of MAP Violations

| Violation Type | Description |
|---------------|-------------|
| **Direct MAP violation** | Advertised price explicitly below MAP |
| **Indirect MAP violation** | Advertised price appears below MAP due to applied discounts, coupons, or rebates |
| **Hidden MAP violation** | Price displayed only after login or in cart, not in general advertising |

### Consequences for Retailers

MAP violations can result in:
- **Warning**: First violation typically results in a warning letter
- **Financial penalty**: Some agreements include per-violation penalties
- **Loss of authorised status**: Repeated violations result in loss of authorised reseller status
- **Loss of benefits**: Co-op advertising funds, promotional support, and product access may be revoked

### Consequences for Manufacturers

Failure to enforce MAP can result in:
- MAP policy becoming unenforceable if not consistently applied
- Retailers losing respect for the brand's pricing policies
- Brand perception damage from widespread discounting

---

## MAP and E-Commerce

MAP enforcement is more complex online than in physical retail:

### Online MAP Challenges

- **Universal visibility**: Any retailer can see any competitor's online advertised price instantly
- **Price aggregators**: Price comparison sites may display prices below MAP, creating the impression that the manufacturer tolerates MAP violations
- **Third-party marketplace**: Authorised resellers on Amazon, eBay, and other marketplaces may violate MAP without consequences
- **Login-restricted pricing**: Some retailers show prices only after account login, complicating monitoring

### MAP in Price Comparison Context

Price comparison engines display advertised prices from multiple retailers. This creates a grey area:
- If a retailer advertises at MAP on their website, the price comparison engine displays that MAP price
- If the price comparison engine itself advertises the price, does it need to respect MAP?
- Manufacturers often require price comparison engines to only display prices at or above MAP

---

## MAP Price Intelligence with BuyWhere

BuyWhere supports MAP monitoring as part of its competitive price intelligence capabilities:

### Cross-Retailer Price Monitoring

BuyWhere continuously monitors advertised prices across all tracked retailers, providing:
- Current advertised prices for all monitored products
- Price change events when prices are updated
- MAP comparison for products where MAP data is available

### MAP Violation Detection

For manufacturers with MAP requirements, BuyWhere can identify:
- Which retailers are advertising below MAP
- How frequently MAP violations occur
- Which products are most frequently violated

### Integration with MAP Enforcement

BuyWhere API data integrates with MAP enforcement workflows:

```
GET /v1/products/{id}/prices
Returns all retailer advertised prices for competitive analysis

GET /v1/retailers/{id}/prices
Returns all products and prices at a specific retailer for audit
```

---

## MAP Monitoring Limitations

### 1. Login-Restricted Pricing

Some retailers only show prices after login, making it impossible to monitor the advertised price without authentication.

### 2. Third-Party Marketplaces

MAP policies typically only cover authorised resellers. Third-party marketplace sellers (on Amazon Marketplace, eBay) are not bound by MAP agreements.

### 3. Promotional Periods

MAP policies often include exceptions for:
- Black Friday / holiday sales
- Short-term clearance events
- Bundle offers

Distinguishing MAP violations from legitimate promotional pricing requires understanding the specific MAP policy terms.

### 4. Jurisdictional Differences

MAP policies are contractually enforceable in most jurisdictions, but specific rules vary:
- EU: Resale price maintenance (including MAP) is legal under certain conditions
- US: MAP is generally legal; absolute resale price maintenance is not
- Some jurisdictions restrict MAP-like policies more strictly

---

## Related Questions

- [What Is Competitive Price Intelligence](/pages/what-is-competitive-price-intelligence)
- [What Is Retailer Price Monitoring](/pages/what-is-retailer-price-monitoring)
- [What Is a Price Benchmark](/pages/what-is-a-price-benchmark)
- [What Is Dynamic Pricing](/pages/what-is-dynamic-pricing)
