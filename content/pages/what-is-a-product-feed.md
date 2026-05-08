---
title: "What Is a Product Feed? — Developer FAQ"
slug: "what-is-a-product-feed"
description: "FAQ explaining what a product feed is in the context of e-commerce and price comparison. Covers feed formats (XML, CSV, JSON), how product feeds work, benefits over scraping, and how BuyWhere uses product feeds."
category: FAQ
tags:
  - "product feed"
  - "what is a product feed"
  - "e-commerce product feed"
  - "product feed XML CSV JSON"
  - "retailer product feed"
  - "product data feed"
  - "Google Shopping feed"
schema_type: Article
published: true
updated: 2026-05-08
---

# What Is a Product Feed? — Developer FAQ

A product feed is a structured file or data stream that contains a retailer's full product catalogue in a standardised format. This FAQ covers what product feeds are, how they work, and how they compare to web scraping for price comparison.

---

## What Is a Product Feed?

A product feed is a structured data export containing all (or a subset of) a retailer's product catalogue. Each product in the feed includes standardised attributes:

- Product name / title
- Description
- Price and currency
- Product category
- Brand and manufacturer
- GTIN / UPC / EAN
- Images
- Stock availability
- Retailer product URL

Feeds are delivered as files (uploaded to a shared location) or via API endpoints that return the full catalogue in a single response.

---

## Common Product Feed Formats

### XML (RSS / Custom)

XML feeds were the original product feed format. Many retailers use custom XML schemas or standard formats like:

- **Google Shopping format**: A Google-defined XML schema for product listings used by many comparison engines
- **RSS 2.0 with extensions**: Some retailers use RSS with custom namespace extensions for product data

XML feeds are verbose but widely supported by older comparison engines.

### CSV

Comma-separated values feeds are simple and universally compatible. Most spreadsheet applications can open them, making debugging straightforward.

The main challenge with CSV is handling multi-value fields (multiple images, category hierarchies) which require delimiter conventions or escaping.

### JSON / JSON Lines

Modern API-driven feeds often return JSON. JSON is easier to parse programmatically than XML and handles nested data structures naturally.

**JSON Lines** (one JSON object per line) is increasingly popular for large feeds because it can be processed line-by-line without loading the entire file into memory.

---

## How Do Product Feeds Work?

### Feed Delivery Mechanisms

**1. Direct file upload**
The retailer uploads a feed file to a shared location (FTP, SFTP, cloud storage bucket) on a schedule. BuyWhere (and other consumers) download the file from that location.

**2. URL-based download**
The retailer provides a URL that returns the current feed file. The URL may include authentication tokens and be regenerated on a schedule.

**3. API endpoint**
The retailer exposes a REST endpoint that returns the full catalogue as JSON or XML. Unlike web scraping (which extracts data from HTML pages), the API is designed to return structured data directly.

**4. Third-party feed aggregation**
Services like Channable, DataFeedWatch, or GoDataFeed aggregate product feeds from multiple retailers into a unified format. This is useful when dealing with retailers who do not provide feeds directly.

### Feed Refresh Schedules

Retailers update their feeds on different schedules:

| Schedule | Use Case |
|----------|----------|
| **Real-time** | Large retailers with APIs; inventory and price updated continuously |
| **Hourly** | Mid-size retailers; prices updated several times per day |
| **Daily** | Smaller retailers; full catalogue refresh once per day |
| **Weekly** | Small catalogues with infrequent changes |

For price comparison, daily feeds are sufficient for most products. Real-time feeds are essential for high-velocity price changes (flash sales, airline tickets).

---

## Product Feed vs. Web Scraping

Product feeds and web scraping are two approaches to acquiring product data:

| | Product Feed | Web Scraping |
|-|-------------|--------------|
| **Data quality** | Structured, consistent | Variable, requires parsing |
| **Coverage** | All products in feed | Only crawled pages |
| **Legal risk** | Lower (authorised use) | Higher (may violate ToS) |
| **Cost** | Often free; sometimes paid | Requires crawler infrastructure |
| **Latency** | Refresh-rate dependent | Depends on crawl frequency |
| **Maintenance** | Feed format changes break parsing | HTML structure changes break selectors |

### When Feeds Are Better

- **Scale**: Feeds provide full catalogue data in one download; crawling requires separate requests for each product page
- **Legal clarity**: Using an authorised feed is clearly permitted; scraping may violate retailer terms of service
- **Data completeness**: Feeds include structured data (GTINs, categories, stock status) that are difficult to extract reliably from HTML
- **Cost**: Maintaining crawlers for hundreds of retailers is expensive; feeds can be free or low-cost

### When Scraping Is Better

- **Availability**: Many retailers do not offer feeds, especially smaller e-commerce sites
- **Real-time data**: Feeds are refreshed on schedule; scraping can be triggered on demand for immediate data
- **Price accuracy**: Feed prices may lag behind website prices by hours; scraping the actual page captures the live price
- **Stock data**: Feed stock status may be less reliable than the actual page stock indicator

---

## What Data Is in a Product Feed?

Standard product feed fields:

| Field | Description | Example |
|-------|-------------|---------|
| `id` | Retailer's product identifier | `SKU-12345` |
| `title` | Product name | `Sony WH-1000XM5 Wireless Headphones` |
| `description` | Product description | `Industry-leading noise cancellation...` |
| `link` | Product page URL | `https://store.com/sony-wh1000xm5` |
| `image_link` | Product image URL | `https://store.com/img/wh1000xm5.jpg` |
| `price` | Current price | `348.00 USD` |
| `sale_price` | Discounted price (if applicable) | `299.00 USD` |
| `availability` | Stock status | `in stock` / `out of stock` / `preorder` |
| `brand` | Brand name | `Sony` |
| `gtin` | Global Trade Item Number | `027242207509` |
| `mpn` | Manufacturer Part Number | `WH1000XM5B` |
| `category` | Product category hierarchy | `Electronics > Audio > Headphones` |
| `google_product_category` | Google's taxonomy ID | `166` (Electronics > Audio) |

Not all feeds contain all fields. Retailer feeds vary widely in completeness.

---

## What Is the Google Shopping Feed Format?

Google Shopping (and many comparison engines that adopted Google's schema) uses a specific XML format for product feeds:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>Store Name</title>
    <link>https://store.com</link>
    <item>
      <g:id>SKU-12345</g:id>
      <g:title>Sony WH-1000XM5 Wireless Headphones</g:title>
      <g:description>Industry-leading noise cancellation...</g:description>
      <g:link>https://store.com/sony-wh1000xm5</g:link>
      <g:image_link>https://store.com/img/wh1000xm5.jpg</g:image_link>
      <g:price>348.00 USD</g:price>
      <g:availability>in stock</g:availability>
      <g:brand>Sony</g:brand>
      <g:gtin>027242207509</g:gtin>
    </item>
  </channel>
</rss>
```

The `g:` namespace fields are Google's defined attributes. Many retailers use this format for their own feeds or accept feeds in this structure for Google Shopping submission.

---

## How Does BuyWhere Use Product Feeds?

BuyWhere integrates product feeds as part of its multi-source data strategy:

1. **Feed ingestion**: BuyWhere accepts product feeds from retailers in multiple formats (XML, CSV, JSON, Google Shopping format)
2. **Feed normalisation**: Feed data is normalised using the same pipeline as scraped data — brand normalisation, model extraction, GTIN processing
3. **Cross-source reconciliation**: When both feed data and crawl data exist for the same product, BuyWhere reconciles them, preferring higher-confidence sources
4. **Feed freshness monitoring**: Feed staleness is tracked; feeds not updated within the expected window trigger alerts
5. **Missing data augmentation**: Feed data that is missing key fields (GTIN, model) is flagged for augmentation via crawling or manual data entry

---

## What Is a Data Feed API?

A data feed API (sometimes called a product data API or commerce API) is a programmatic interface that returns product catalogue data in real-time, as opposed to a batch file download.

| | Batch Feed File | Data Feed API |
|-|----------------|---------------|
| **Delivery** | File downloaded on schedule | Requested via HTTP on demand |
| **Volume** | Full catalogue each time | Specific products or pages |
| **Latency** | Refresh-rate lag (hours to days) | Near real-time |
| **Cost** | Often free | Often paid / rate-limited |

Examples of data feed APIs include:
- **Commerce Layer**: Product catalogue API
- **Shopify Storefront API**: Product data via API
- **Amazon SP-API**: Product offer data for sellers

BuyWhere uses both batch feeds (for broad coverage) and data feed APIs (for real-time price updates on high-priority products).

---

## Related Questions

- [What Is Real-Time Price Data](/pages/what-is-real-time-price-data)
- [API vs. Scraping vs. Feeds](/pages/api-vs-scraping-vs-feeds)
- [What Is a Price Comparison API](/pages/what-is-price-comparison-api)
