# BuyWhere MCP Server — Agent Guide

BuyWhere is an MCP server that gives AI agents real-time cross-border product search and price comparison across US and Southeast Asian markets.

## Quick Start

```json
{
  "mcpServers": {
    "buywhere": {
      "command": "npx",
      "args": ["-y", "@buywhere/mcp-server"],
      "env": {
        "BUYWHERE_API_KEY": "<your-key>"
      }
    }
  }
}
```

Get a free API key at https://buywhere.ai/api-keys

## Tools

### search_products
Natural language product search across markets.
- `query` (string, required): Product name or natural language description
- `category` (string, optional): Product category filter
- `max_price` (number, optional): Maximum price filter
- `market` (string, optional): Region filter (sg, my, us)

### get_product
Full product details by ID.
- `product_id` (string, required): Product identifier

### compare_products
Side-by-side comparison of 2-5 products.
- `product_ids` (array of strings, required): 2-5 product IDs to compare

### get_deals
Current promotions and price drops.
- `category` (string, optional): Category to find deals in
- `min_discount` (number, optional): Minimum discount percentage

### list_categories
Available product category taxonomy.

## Example Prompts

**Product search:** "Find wireless noise-canceling headphones under $150"
→ Call `search_products(query="wireless noise-canceling headphones", max_price=150)

**Price comparison:** "Compare Sony WH-1000XM5 prices across US and Singapore markets"
→ Call `search_products(query="Sony WH-1000XM5")` across relevant markets

**Deal hunting:** "Find electronics with at least 30% off"
→ Call `get_deals(category="electronics", min_discount=30)

**Gift recommendations:** "Find a birthday gift for a coffee lover under $50"
→ Call `search_products(query="coffee gift", max_price=50)

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| BUYWHERE_API_KEY | (required) | API key from https://buywhere.ai/api-keys |

## Related Resources

- https://buywhere.ai/llms.txt — structured agent context
- https://buywhere.ai/llms-full.txt — complete API reference
- https://github.com/BuyWhere/buywhere — source code
