# Claude MCP Registry Submission — BuyWhere

Pre-filled fields for the Anthropic MCP Registry Google Form.

## Form Fields

**Server Name:** BuyWhere

**Short Description:** Agent-native product catalog API for Singapore and global e-commerce. Search 1.5M+ products, compare prices across 20+ platforms, find deals, and browse categories.

**Server Category:** Shopping / E-Commerce

**GitHub Repository URL:** https://github.com/buywhere/buywhere-api

**NPM Package (if applicable):** N/A (Python-based, install via pip or run directly)

**Installation Command:**
```bash
pip install httpx mcp
python mcp_server.py
```

**Required Environment Variables:**
- `BUYWHERE_API_KEY` — Your BuyWhere API key (required, get one at https://buywhere.ai/developers)
- `BUYWHERE_API_URL` — API base URL (default: https://api.buywhere.ai)

**Tools Provided:**
1. `search_products` — Full-text search across all products with category, price, platform, and availability filters
2. `get_product` — Retrieve full product details by ID
3. `compare_prices` — Compare prices across platforms sorted by price ascending
4. `get_deals` — Find discounted products sorted by discount depth
5. `browse_categories` — Browse category taxonomy tree
6. `get_category_products` — Get products within a category

**Test API Key:** `bw_live_[TO_BE_GENERATED]`

**Contact Email:** dev@buywhere.ai

**Website:** https://buywhere.ai

**Documentation:** https://docs.buywhere.ai

## Claude Desktop Config Example

```json
{
  "mcpServers": {
    "buywhere": {
      "command": "python",
      "args": ["/path/to/buywhere-api/mcp_server.py"],
      "env": {
        "BUYWHERE_API_KEY": "bw_live_your_key_here",
        "BUYWHERE_API_URL": "https://api.buywhere.ai"
      }
    }
  }
}
```
