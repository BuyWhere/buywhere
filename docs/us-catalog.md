# Amazon US Product Catalog — Coverage, MCP Integration, and Affiliate Earnings

BuyWhere's Amazon US catalog gives AI agents access to **600,000+ products** across five core verticals, all normalized into a single agent-native schema with affiliate-ready purchase links.

---

## Catalog Coverage

| Category | Products | Top Subcategories |
|----------|----------|-------------------|
| Electronics | 180,000+ | Headphones, laptops, tablets, cameras, smart home |
| Fashion | 150,000+ | Men's/women's apparel, shoes, accessories, watches |
| Home | 120,000+ | Kitchen appliances, furniture, decor, bedding |
| Sports | 90,000+ | Fitness equipment, outdoor gear, sports apparel |
| Beauty | 60,000+ | Skincare, makeup, haircare, supplements |

All products include real-time price, availability signals, rating data, and BuyWhere-affiliated purchase links for commission tracking.

---

## API Access — US Products Only

Filter to Amazon US listings using the `region=us` parameter or `platform=amazon_us`:

```bash
curl "https://api.buywhere.ai/v2/search?q=sony+wh-1000xm5&region=us&limit=10" \
  -H "Authorization: Bearer bw_live_xxxxxxxxxxxxxxxx"
```

```json
{
  "query": "sony wh-1000xm5",
  "total": 47,
  "items": [
    {
      "id": 849201,
      "source": "amazon_us",
      "title": "Sony WH-1000XM5 Wireless Noise Canceling Headphones",
      "price": "348.00",
      "currency": "USD",
      "buy_url": "https://www.amazon.com/dp/B09XS7JWHH",
      "affiliate_url": "https://buywhere.ai/track/abc123",
      "brand": "Sony",
      "category": "Electronics",
      "rating": 4.7,
      "review_count": 12430,
      "is_available": true
    }
  ]
}
```

### Filtering by Platform

```bash
# Amazon US only
curl "https://api.buywhere.ai/v2/search?q=wireless+earbuds&platform=amazon_us&limit=10" \
  -H "Authorization: Bearer bw_live_xxxxxxxxxxxxxxxx"

# US region (includes Amazon US, Walmart, Target, Best Buy)
curl "https://api.buywhere.ai/v2/search?q=wireless+earbuds&region=us&limit=10" \
  -H "Authorization: Bearer bw_live_xxxxxxxxxxxxxxxx"
```

---

## MCP Integration

The BuyWhere MCP server exposes seven tools for AI agents. All tools support regional filtering — pass `region: "us"` or `platform: "amazon_us"` to scope results to Amazon US.

### Prerequisites

```bash
# Install the BuyWhere MCP server
pip install buywhere-mcp

# Set your API key
export BUYWHERE_API_KEY=bw_live_xxxxxxxxxxxxxxxx
```

### MCP Tool 1 — Search Amazon US Products

```python
# Agent calls this to find products matching a query
result = await server.call_tool("search_products", {
    "query": "running shoes for flat feet",
    "platform": "amazon_us",
    "max_price": 150,
    "limit": 10
})
```

```
User: "Find me supportive running shoes under $150 on Amazon"

Agent calls:
  search_products(
    query="running shoes",
    platform="amazon_us",
    max_price=150,
    limit=10
  )

→ Returns 10 ranked results with prices, ratings, and affiliate links
```

### MCP Tool 2 — Best Price on Amazon US

```python
# Find the cheapest listing for a specific product
result = await server.call_tool("find_best_price", {
    "product_name": "Apple AirPods Pro 2nd gen",
    "platform": "amazon_us"
})
```

```
User: "What's the cheapest price for AirPods Pro on Amazon right now?"

Agent calls:
  find_best_price(
    product_name="Apple AirPods Pro 2nd gen",
    platform="amazon_us"
  )

→ Returns: price, seller, availability, affiliate link
```

### MCP Tool 3 — Cross-Category Deals on Amazon US

```python
# Find discounted products in a category
result = await server.call_tool("get_deals", {
    "category": "electronics",
    "region": "us",
    "min_discount_pct": 20,
    "limit": 15
})
```

```
User: "Show me electronics deals over 20% off on Amazon US"

Agent calls:
  get_deals(
    category="electronics",
    region="us",
    min_discount_pct=20,
    limit=15
  )

→ Returns products with current price, original price, and discount %
```

---

## Amazon Associates Commission Rates

When agents complete purchases through BuyWhere affiliate links, BuyWhere earns commissions from Amazon Associates. Commissions vary by category:

| Category | Commission Rate |
|----------|----------------|
| Luxury Beauty | 10% |
| Beauty | 4.5% |
| Home & Kitchen | 4.5% |
| Sports & Outdoors | 4.5% |
| Grocery | 3% |
| Electronics | 3% |
| Fashion | 4.5% |
| Books | 4.5% |
| Video Games | 1% |
| Toys | 3% |

Cookie duration: **24 hours** standard, **90 days** for cart-adds within 24 hours.

---

## Getting Started

1. **Get an API key** at [api.buywhere.ai](https://api.buywhere.ai)
2. **Filter to US** using `region=us` or `platform=amazon_us`
3. **Connect via MCP** — configure your MCP server with `BUYWHERE_API_KEY`
4. **Build your agent** — use the seven MCP tools for search, compare, and deal discovery

For full API documentation, see [api.buywhere.ai/docs](https://api.buywhere.ai/docs).

For MCP setup instructions, see the [MCP Primer](/docs/mcp-primer.md).
