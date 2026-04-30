# How I Built a Price Comparison Agent for Singapore E-Commerce Using BuyWhere

## The Problem

Building a price comparison agent for Singapore e-commerce is harder than it should be. The major platforms—Lazada, Shopee, Best Denki, Courts, Harvey Norman—don't offer clean APIs for product data. Scraping is fragile, HTML parsing breaks constantly, and each platform has different structure.

The result: most "shopping agents" are just chatbot wrappers that scrape product pages at query time, making them slow and unreliable.

## The BuyWhere Solution

I built a price comparison agent using BuyWhere, a product catalog API that indexes Singapore e-commerce in structured JSON-LD. The key difference: product data is pre-indexed and served as structured data, not scraped at query time.

```python
import json
import httpx

# BuyWhere MCP endpoint for structured product data
MCP_URL = "https://api.buywhere.ai/mcp"

def find_cheapest RTX_4060():
    response = httpx.post(MCP_URL, json={
        "tool": "products_search",
        "parameters": {
            "query": "RTX 4060",
            "region": "sg",
            "limit": 10
        }
    })
    products = response.json()["products"]
    
    # Sort by price, filter for availability
    in_stock = [p for p in products if p["offers"]["availability"] == "InStock"]
    cheapest = min(in_stock, key=lambda p: float(p["offers"]["price"]))
    
    return f"Cheapest RTX 4060: {cheapest['name']} at {cheapest['offers']['seller']} for {cheapest['offers']['price']} SGD"

print(find_cheapest RTX_4060())
# Output: Cheapest RTX 4060: MSI GeForce RTX 4060 Gaming X 8G at Lazada for 519.00 SGD
```

## Why JSON-LD Matters for AI Agents

BuyWhere returns products in Schema.org JSON-LD format. This is intentionally chosen because:

1. **No custom parsing** — JSON-LD is self-describing, LLMs parse it without special handlers
2. **Standard schema** — `Product`, `Offer`, `priceCurrency`, `seller` are universal
3. **Deep linking** — each product has stable identifiers that reference back to source

Example response structure:

```json
{
  "@type": "Product",
  "name": "MSI GeForce RTX 4060 Gaming X 8G",
  "brand": { "@type": "Brand", "name": "MSI" },
  "offers": {
    "@type": "Offer",
    "price": "519.00",
    "priceCurrency": "SGD",
    "seller": { "@type": "Organization", "name": "Lazada" },
    "availability": "InStock",
    "url": "https://www.lazada.sg/products/msi-rtx-4060..."
  }
}
```

## What I Built

The agent handles:
- Multi-platform price comparison across Lazada, Shopee, Best Denki, Courts, Harvey Norman
- Availability filtering — shows only in-stock items
- Merchant reputation signals
- Price history (where available)

## For Developers: Try the MCP Endpoint

If you're building shopping agents or price comparison tools, the MCP endpoint is the fastest integration path:

```
https://api.buywhere.ai/mcp
```

Or use the REST API directly:
```
https://api.buywhere.ai/v1/products?region=sg&q=RTX+4060
```

Free beta with 7,400+ Singapore products indexed.

## The Architecture Insight

The real insight isn't the price comparison—it's the data architecture. Pre-indexed, structured product data in a standard schema beats scraping at query time for the same reason CDN beats origin servers: you're moving compute close to the data, not the data to the compute.

For AI agents that need to answer shopping questions reliably, this matters. The agent shouldn't need to scrape 5 platforms at query time to answer "where's the cheapest RTX 4060 in Singapore?" It should ask an API that already did that work.

---

*BuyWhere is in open beta. 7,400+ Singapore products from Lazada, Shopee, Best Denki, Courts, Harvey Norman indexed in structured JSON-LD.*