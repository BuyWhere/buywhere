# @buywhere/mcp-server

[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-ai.buywhere%2Fbuywhere--mcp-blue)](https://registry.modelcontextprotocol.io/servers/ai.buywhere/buywhere-mcp)
[![npm version](https://img.shields.io/npm/v/@buywhere/mcp-server.svg)](https://www.npmjs.com/package/@buywhere/mcp-server)
[![npm downloads](https://img.shields.io/npm/dm/@buywhere/mcp-server.svg)](https://www.npmjs.com/package/@buywhere/mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Cross-border product catalog for AI agents.** Search and compare products from Singapore, SEA, and US markets via [Model Context Protocol](https://modelcontextprotocol.io).

Works with Claude Desktop, Cursor, VS Code Copilot, Cline, OpenCode, and any MCP-compatible client.

> **[Get your free API key →](https://buywhere.ai/api-keys)**  
> *No credit card required. 1,000 free queries/month.*

---

## Quick Start

```bash
export BUYWHERE_API_KEY=bw_live_xxxx
npx -y @buywhere/mcp-server
```

Get your key: [buywhere.ai/api-keys](https://buywhere.ai/api-keys)

## Example Output

```
> search_products("wireless headphones")

Found 24 products across 3 markets:

┌──────────────────────────────────┬──────────┬──────────────┐
│ Product                          │ Price    │ Merchant     │
├──────────────────────────────────┼──────────┼──────────────┤
│ Sony WH-1000XM5 (Singapore)      │ $398.00  │ Lazada SG    │
│ Sony WH-1000XM5 (Malaysia)       │ $372.00  │ Shopee MY    │
│ Sony WH-1000XM5 (US)             │ $329.99  │ Amazon US    │
│ Samsung Galaxy Buds2 Pro (SG)    │ $188.00  │ Lazada SG    │
│ ...                              │ ...      │ ...          │
└──────────────────────────────────┴──────────┴──────────────┘

Savings: Buy from US Merchant, save up to $68 on Sony WH-1000XM5.
```

**One query. Cross-border prices. Instant comparison.**

---

## Tools

| Tool | Description |
|------|-------------|
| `search_products` | Search catalog by keyword, category, price, region |
| `get_product` | Full product details by ID (prices, specs, images) |
| `compare_products` | Side-by-side comparison of 2–10 products |
| `get_deals` | Current price drops and promotions across markets |
| `list_categories` | Available product category taxonomy |
| `find_best_price` | Find lowest price for a product across all merchants |
| `find_similar` | "More like this" — nearest neighbours by semantic similarity |

### Search modes

`search_products` accepts a `mode` parameter:

| Mode | Behaviour |
|------|-----------|
| `hybrid` *(default)* | RRF blend of full-text and vector search |
| `keyword` | Full-text search only — no vector path |
| `semantic` | Vector similarity only |

> **Tip:** if `search_products` returns `Internal error: different vector dimensions`,
> pass `mode: "keyword"` to bypass the vector path while the embedding index is
> being rebuilt.

## Claude Desktop Setup

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "buywhere": {
      "command": "npx",
      "args": ["-y", "@buywhere/mcp-server"],
      "env": {
        "BUYWHERE_API_KEY": "bw_live_xxxx"
      }
    }
  }
}
```

## Cursor / VS Code / Cline

Same config — add to your MCP settings file:

```json
{
  "mcpServers": {
    "buywhere": {
      "command": "npx",
      "args": ["-y", "@buywhere/mcp-server"],
      "env": {
        "BUYWHERE_API_KEY": "bw_live_xxxx"
      }
    }
  }
}
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `BUYWHERE_API_KEY` | (required) | API key from [buywhere.ai/api-keys](https://buywhere.ai/api-keys) |
| `BUYWHERE_API_URL` | `https://api.buywhere.ai` | API base URL, **without** a `/mcp` suffix — the server appends `/mcp` itself. (A trailing `/mcp` is tolerated for backwards compatibility.) |

## Contributing

This package advertises its own copy of the tool schemas while proxying calls to
the live `/mcp` endpoint, so the two can silently drift apart. Before publishing:

```bash
npm run build
BUYWHERE_API_KEY=bw_live_xxxx npm run check-drift
```

`check-drift` diffs the package's advertised tools against the live
`tools/list` contract and exits non-zero on any missing tool, missing
parameter, or enum mismatch.

## Links

- [API Docs](https://api.buywhere.ai/docs)
- [MCP Integration Guide](https://api.buywhere.ai/docs/guides/mcp)
- [Developer Portal](https://buywhere.ai/developers)

## License

MIT
