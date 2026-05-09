---
title: "What Is a Retailer Product Feed? — Developer FAQ"
slug: "what-is-a-retailer-product-feed"
description: "FAQ explaining what a retailer product feed is, how it differs from a product data feed, feed formats, delivery mechanisms, and how BuyWhere uses retailer product feeds for price comparison."
category: FAQ
tags:
  - "retailer product feed"
  - "product data feed"
  - "e-commerce feed"
  - "retailer data integration"
  - "product feed format"
  - "feed delivery"
schema_type: Article
published: true
updated: 2026-05-08
---

# What Is a Retailer Product Feed? — Developer FAQ

A retailer product feed is a structured data file or API response provided by a retailer that contains their product catalogue. This FAQ covers what retailer product feeds are, how they work, and how BuyWhere uses them.

---

## What Is a Retailer Product Feed?

A retailer product feed is a structured data export of a retailer's product catalogue. It contains product information — prices, descriptions, categories, images, stock status — in a standardised format that buyers and partners can consume.

Unlike a single product page (which describes one product), a product feed contains all products in the retailer's catalogue.

### Product Feed vs. Product Data Feed

These terms are often used interchangeably. Both refer to a structured export of product catalogue data.

The distinction sometimes made:
- **Product feed**: Provided by the retailer for use by comparison engines and affiliates
- **Data feed**: Provided by a data aggregator that has collected data from multiple sources

In practice, the terms are synonymous.

---

## What Data Is in a Retailer Product Feed?

A retailer product feed typically contains:

### Core Product Fields

| Field | Description | Example |
|-------|-------------|---------|
| `product_id` | Retailer's internal product ID | `SKU-12345` |
| `product_name` | Product title | `Sony WH-1000XM5 Headphones` |
| `description` | Product description | `Industry-leading noise cancellation...` |
| `price` | Current price | `349.00` |
| `currency` | Price currency | `USD` |
| `brand` | Brand name | `Sony` |
| `category` | Product category path | `Electronics > Audio > Headphones` |
| `product_url` | URL to product page | `https://store.com/sony-wh1000xm5` |
| `image_url` | Product image URL | `https://store.com/img/xm5.jpg` |
| `availability` | Stock status | `in_stock` / `out_of_stock` / `limited` |

### Extended Fields

| Field | Description |
|-------|-------------|
| `gtin` | Global Trade Item Number |
| `mpn` | Manufacturer Part Number |
| `model` | Model number |
| `color` | Product colour |
| `size` | Product size |
| `weight` | Product weight |
| `shipping_cost` | Shipping cost |
| `condition` | New / refurbished / used |
| `age_group` | Adult / kids / toddler / infant |
| `gender` | Male / female / unisex |

Not all feeds contain all fields. Feed completeness varies significantly by retailer.

---

## Retailer Product Feed Formats

### XML

XML feeds were the original format for product feeds. Common XML schemas:

- **Custom XML**: Retailer-defined schema
- **Google Shopping format**: Standardised XML schema defined by Google
- **RSS 2.0 with extensions**: RSS-based format with custom namespace extensions

```xml
<?xml version="1.0" encoding="UTF-8"?>
<products>
  <product>
    <id>SKU-12345</id>
    <name>Sony WH-1000XM5 Headphones</name>
    <price currency="USD">349.00</price>
    <brand>Sony</brand>
    <gtin>027242207509</gtin>
    <link>https://store.com/sony-wh1000xm5</link>
    <image>https://store.com/img/xm5.jpg</image>
    <availability>in_stock</availability>
  </product>
</products>
```

XML is verbose but supports complex nested structures.

### CSV

CSV feeds are simple and universally compatible:

```csv
product_id,product_name,price,currency,brand,gtin,product_url,availability
SKU-12345,Sony WH-1000XM5 Headphones,349.00,USD,Sony,027242207509,https://store.com/sony-wh1000xm5,in_stock
```

CSV handles most product data well. Challenges arise with multi-value fields (multiple images, category hierarchies) and fields containing commas.

### JSON

Modern API-driven feeds use JSON:

```json
{
  "products": [
    {
      "id": "SKU-12345",
      "name": "Sony WH-1000XM5 Headphones",
      "price": { "amount": 349.00, "currency": "USD" },
      "brand": "Sony",
      "gtin": "027242207509",
      "url": "https://store.com/sony-wh1000xm5",
      "availability": "in_stock"
    }
  ]
}
```

JSON is easier to parse programmatically and handles nested structures naturally.

### JSON Lines

For large feeds, JSON Lines (one JSON object per line) is increasingly popular:

```jsonl
{"id":"SKU-12345","name":"Sony WH-1000XM5","price":349.00}
{"id":"SKU-12346","name":"Sony WH-1000XM4","price":279.00}
```

JSON Lines can be processed line-by-line without loading the entire file into memory, making it efficient for very large catalogues.

---

## How Are Retailer Product Feeds Delivered?

### 1. File Download (SFTP / HTTPS)

The retailer hosts a feed file on a server or cloud storage, and partners download it:

- **SFTP**: Secure file transfer protocol — retailer provides credentials
- **HTTPS**: Authenticated URL — retailer provides API key or login
- **Cloud storage**: Retailer puts files in S3, Google Cloud Storage, Azure Blob — partners access via credentials

Typical schedule:
- Full feed: Weekly or monthly
- Incremental feed: Daily or hourly (only products changed since last feed)

### 2. URL-Based Feed

The retailer provides a URL that returns the current feed file:

```
https://feeds.retailer.com/store/partner_feed?key=API_KEY&format=csv
```

The URL may include authentication parameters and generate a fresh file on each request or return a pre-generated file.

### 3. API Endpoint

The retailer exposes a REST API that returns product data:

```
GET /products?page=1&limit=100
GET /products/{id}
GET /products?category=headphones
```

API-based feeds offer:
- Real-time data access
- Selective retrieval (only needed products)
- No file handling

### 4. Third-Party Feed Aggregation

Services aggregate feeds from multiple retailers into a unified format:

- **Channelfactory**: Multi-retailer feed aggregation
- **DataFeedWatch**: Feed management for e-commerce
- **GoDataFeed**: Cloud-based feed management
- **LiketoPay**: Feed distribution network

Aggregators solve the problem of dealing with dozens of different retailer feed formats by normalising everything to a single output format.

---

## Retailer Feed vs. Web Scraping

| | Retailer Feed | Web Scraping |
|-|---------------|--------------|
| **Data quality** | Structured, consistent | Variable, requires parsing |
| **Coverage** | All products in feed | Only crawled pages |
| **Legal risk** | Authorised use | May violate ToS |
| **Latency** | Refresh-rate dependent | Depends on crawl frequency |
| **Cost** | Often free | Infrastructure cost |
| **Availability** | Not all retailers offer feeds | Any publicly accessible site |

### When Feeds Are Better

- **Scale**: A feed download provides the full catalogue in one transfer
- **Legal clarity**: Using an authorised feed is clearly permitted
- **Data completeness**: Feeds include structured fields that are difficult to extract from HTML
- **Cost**: Feeds can be free; scraping requires infrastructure

### When Scraping Is Better

- **Availability**: Many retailers do not offer feeds
- **Real-time data**: Feeds are refreshed on schedule; scraping can be on-demand
- **Price accuracy**: Feed prices may lag actual prices; scraping the page captures the live price
- **Stock accuracy**: Feed stock status may be less reliable than actual page indicators

---

## What Are the Challenges with Retailer Product Feeds?

### 1. Feed Format Inconsistency

Every retailer uses a different format:
- Different field names (`product_name` vs. `title` vs. `name`)
- Different category hierarchies (`Electronics/Audio/Headphones` vs. `Headphones > Audio > Electronics`)
- Different price formats (`349.00 USD` vs. `USD 349.00` vs. `349`)
- Different availability values (`in stock` vs. `InStock` vs. `1`)

Normalising these differences is a significant part of feed processing.

### 2. Feed Completeness

No feed contains all the data you need. Common gaps:
- Missing GTINs
- Missing category information
- Missing images
- Missing stock status
- Missing product descriptions

### 3. Feed Freshness

Feeds are often stale by the time they are processed:
- Daily feeds reflect yesterday's prices
- Weekly feeds reflect prices from a week ago
- Some retailers do not update feeds when prices change

For real-time price intelligence, feed data must be supplemented with scraping.

### 4. Feed Access Restrictions

Many retailers restrict feed access:
- Partners only (affiliate, marketplace)
- Minimum volume requirements
- Approval processes
- NDA and data usage restrictions

### 5. Large File Sizes

Large retailer catalogues produce large feed files:
- Amazon has millions of products
- A full Amazon feed can be tens of gigabytes
- Processing large files requires significant infrastructure

---

## How Does BuyWhere Use Retailer Product Feeds?

BuyWhere integrates retailer product feeds as part of its multi-source data strategy:

### 1. Feed Ingestion

BuyWhere accepts feeds from retailers in multiple formats:
- XML (Google Shopping format, custom XML)
- CSV (with configurable column mapping)
- JSON (flat and nested structures)
- JSON Lines (for large feeds)

### 2. Feed Normalisation

Feed data is normalised using BuyWhere's standard data model:
- Field mapping: retailer field names → BuyWhere standard fields
- Category normalisation: retailer categories → Google Taxonomy IDs
- Price normalisation: all prices → canonical currency
- Availability normalisation: retailer-specific values → standard values

### 3. Cross-Source Reconciliation

When BuyWhere has both feed data and scraped data for the same product:
- **Price**: Prefer scraped data (more real-time) over feed data
- **GTIN**: Prefer feed data (more reliable) over scraped extraction
- **Availability**: Prefer scraped data (more current) over feed data

### 4. Feed Monitoring

BuyWhere monitors feed quality:
- Feed staleness alerts when feeds are not updated on schedule
- Data completeness scoring (what % of expected fields are populated)
- Price deviation detection (significant differences between feed and scraped prices)

---

## Related Questions

- [What Is a Product Feed](/pages/what-is-a-product-feed)
- [What Is a Product Identifier](/pages/what-is-a-product-identifier)
- [How a Price Comparison Engine Works](/pages/how-price-comparison-engine-works)
- [What Is Retailer Price Monitoring](/pages/what-is-retailer-price-monitoring)
