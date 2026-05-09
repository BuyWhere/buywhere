---
title: "What Is a Shopping Comparison Widget? — Developer FAQ"
slug: "what-is-a-shopping-comparison-widget"
description: "FAQ explaining what a shopping comparison widget is, how it works, and how publishers and developers can embed BuyWhere's price comparison data on their sites via comparison widgets."
category: FAQ
tags:
  - "shopping comparison widget"
  - "price comparison widget"
  - "embed price comparison"
  - "product comparison embed"
  - "publisher price widget"
  - "comparison table widget"
  - "buywhere widget"
schema_type: Article
published: true
updated: 2026-05-08
---

# What Is a Shopping Comparison Widget? — Developer FAQ

A shopping comparison widget is an embeddable component that displays real-time price comparison data from an external price comparison engine on a publisher's website. This FAQ covers how shopping comparison widgets work, their use cases, and how BuyWhere provides widget functionality.

---

## What Is a Shopping Comparison Widget?

A shopping comparison widget is a self-contained UI component that publishers embed on their site to display product price comparisons without building their own price comparison infrastructure.

```
Publisher Website
┌──────────────────────────────────────────────┐
│  Article: "Best Wireless Headphones 2026"    │
│                                              │
│  ┌────────────────────────────────────────┐ │
│  │  Price Comparison Widget                │ │
│  │  ┌────┬────────┬────────┬────────┐     │ │
│  │  │Prod│ Retail │ Price  │ Buy    │     │ │
│  │  ├────┼────────┼────────┼────────┤     │ │
│  │  │XM5 │Amazon  │ $299   │ →      │     │ │
│  │  │XM5 │BestBuy │ $312   │ →      │     │ │
│  │  │XM5 │Walmart │ $329   │ →      │     │ │
│  │  └────┴────────┴────────┴────────┘     │ │
│  │  Last updated: May 8, 2026            │ │
│  └────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

The widget connects to the price comparison engine's API in real-time, displaying current prices for the referenced product.

---

## How Does a Shopping Comparison Widget Work?

### Widget Integration Flow

```
1. Publisher embeds widget script on their site
2. Widget initialises with product ID (e.g., canonical product ID)
3. Widget calls BuyWhere API for current price data
4. API returns current prices across all monitored retailers
5. Widget renders the price comparison table
6. User clicks "Buy" → redirected to retailer product page
7. Affiliate/click attribution recorded
```

### Widget Implementation Options

#### JavaScript Embed

The simplest integration — add a script tag and a div where the widget should render:

```html
<!-- 1. Add the widget container -->
<div id="buywhere-widget"
     data-product-id="PRD-SONY-WH1000XM5-BLK"
     data-theme="light">
</div>

<!-- 2. Load the widget script -->
<script src="https://api.buywhere.com/widgets/v1/embed.js"
        async></script>
```

#### iFrame Embed

For stricter sandboxing, wrap the widget in an iframe:

```html
<iframe
  src="https://api.buywhere.com/widgets/v1/embed?product_id=PRD-SONY-WH1000XM5-BLK"
  width="100%"
  height="400"
  frameborder="0">
</iframe>
```

#### Web Component

For modern frameworks, use the native web component:

```html
<script type="module"
        src="https://api.buywhere.com/widgets/v1/web-component.js">
</script>

<buywhere-widget
  product-id="PRD-SONY-WH1000XM5-BLK"
  theme="light"
  max-retailers="5">
</buywhere-widget>
```

---

## What Does a Shopping Comparison Widget Display?

A typical shopping comparison widget shows:

| Element | Description |
|---------|-------------|
| **Product name** | Canonical product name |
| **Retailer list** | All retailers with this product |
| **Current price** | Real-time price from each retailer |
| **Price change indicator** | ▲/▼ showing if price moved since last check |
| **Stock status** | In stock / low stock / out of stock |
| **Buy button** | Link to retailer product page |
| **Last updated** | Timestamp showing data freshness |
| **Price range** | Lowest and highest price across retailers |

### Widget Customisation Options

Widgets can be customised to match publisher design:

| Option | Description |
|--------|-------------|
| **Theme** | Light / dark / transparent |
| **Max retailers** | Limit number of retailers shown |
| **Sort order** | By price / by retailer / by rating |
| **Hide elements** | Hide stock status, price change indicator, etc. |
| **Custom styling** | CSS overrides for colours, fonts |

---

## Why Should Publishers Use Shopping Comparison Widgets?

### For Content Publishers

Content publishers (blogs, review sites, news sites) monetise through affiliate revenue. Shopping comparison widgets:

- **Monetise product mentions**: Every product mentioned in an article can display a widget
- **Increase affiliate revenue**: Direct links to retailers with affiliate tracking
- **Improve user experience**: Readers can compare prices without leaving the site
- **Keep content current**: Widget prices update automatically

### For E-Commerce Sites

E-commerce sites can use widgets to:

- **Show price competitiveness**: "See how our price compares to competitors"
- **Expand product catalogue**: Display products they do not sell via affiliate links
- **Add price comparison to product pages**: "Customers who viewed this also compared..."

### For Price Tracker Sites

Price tracker sites can embed widgets to:

- **Supplement their own data**: Use BuyWhere for retailers they do not track
- **Provide comparison context**: Show broader market prices alongside tracked prices
- **Reduce crawling costs**: Use BuyWhere API instead of crawling all retailers themselves

---

## How Do Affiliate Links Work in Widgets?

Widgets typically include affiliate links:

```
User clicks "Buy" on widget
       │
       ▼
Redirects to: https://retailer.com/product?ref=buywhere&affiliate=PUBLISHER_ID
       │
       ▼
Affiliate network records the attribution
       │
       ▼
Publisher earns commission on sale
       │
       ▼
Price comparison engine may also earn a share
```

The affiliate relationship is typically established through:
- **Affiliate networks**: ShareASale, Awin, CJ Affiliate
- **Direct retailer partnerships**: Some retailers have direct affiliate programmes
- **Price comparison engine affiliate programme**: BuyWhere may pass through affiliate revenue to publishers

---

## What Is the API Behind a Shopping Comparison Widget?

The widget is powered by a price comparison API. BuyWhere's widget API:

```
GET /v1/widgets/compare?product_id={canonical_id}
Response:
{
  "product": {
    "id": "PRD-SONY-WH1000XM5-BLK",
    "name": "Sony WH-1000XM5 Wireless Noise Cancelling Headphones",
    "brand": "Sony",
    "model": "WH-1000XM5",
    "canonical_url": "https://buywhere.com/products/PRD-SONY-WH1000XM5-BLK"
  },
  "listings": [
    {
      "retailer": "Amazon",
      "price": 299.00,
      "currency": "USD",
      "url": "https://amazon.com/...",
      "in_stock": true,
      "last_updated": "2026-05-08T12:00:00Z"
    },
    ...
  ],
  "price_summary": {
    "lowest": 299.00,
    "highest": 399.00,
    "average": 335.00,
    "count": 8
  }
}
```

---

## Widget vs. Full API Integration

| | Widget | Full API |
|-|--------|--------|
| **Integration effort** | Minutes (script embed) | Hours to days (custom integration) |
| **Customisation** | Limited to widget options | Full control |
| **Maintenance** | Handled by BuyWhere | Your responsibility |
| **Cost** | Typically free (revenue share) | May have API costs |
| **Best for** | Publishers wanting quick integration | Developers wanting full control |

---

## What Are the Limitations of Shopping Comparison Widgets?

### 1. Limited Customisation

Widgets offer fewer customisation options than a custom-built comparison table. If you need a highly branded or unique comparison experience, a full API integration is better.

### 2. Performance Impact

Third-party widgets add JavaScript that can impact page load performance. Performance best practices:
- Load widget scripts asynchronously (`async` attribute)
- Lazy-load widgets below the fold
- Use efficient iframe sandboxes for untrusted widget code

### 3. Data Freshness

Widgets display data as of the last API response. If the API is queried infrequently, widget data may be stale. Configuring appropriate cache-Control headers and refresh intervals is important.

### 4. Attribution Loss

Users who click through widget affiliate links are tracked. However, some users may navigate directly to retailers without using widget links, bypassing attribution.

---

## How Does BuyWhere Provide Shopping Comparison Widgets?

BuyWhere offers embeddable shopping comparison widgets for publishers:

### Available Widget Types

| Widget | Description |
|--------|-------------|
| **Price Comparison Table** | Full retailer price table with buy links |
| **Price Badge** | Inline badge showing lowest price |
| **Price Alert CTA** | "Alert me when price drops" embed |
| **Price Chart** | Inline mini price history chart |
| **Best Price Banner** | Banner showing current best price and retailer |

### Getting Started

Publishers can get widget access through:
- BuyWhere publisher programme (affiliate-based)
- BuyWhere API subscription (for full API access with widget options)

---

## Related Questions

- [What Is a Price Comparison API](/pages/what-is-price-comparison-api)
- [How a Price Comparison Engine Works](/pages/how-price-comparison-engine-works)
- [What Is Cross-Merchant Price Data](/pages/what-is-cross-merchant-price-data)
- [Best Shopping Agents API](/compare/best-shopping-agents-api)
