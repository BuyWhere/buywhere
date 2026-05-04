# BuyWhere API

The product catalog API for AI agent commerce — search, compare, and track prices across 40+ retailers in Southeast Asia and the US.

## Overview

BuyWhere is an agent-native product catalog API indexing 5M+ products from 40+ retailers across Singapore, Malaysia, Indonesia, Thailand, the Philippines, Vietnam, and the United States. It is purpose-built for AI shopping agents: BM25-ranked search, structured price comparison, deals discovery, and affiliate link tracking out of the box. The API is MCP-compatible and works with Claude Desktop, Cursor, LangChain, CrewAI, and any MCP-enabled AI client.

## Quick Start

Get an API key at [buywhere.ai/api-keys](https://buywhere.ai/api-keys), then:

```bash
export BUYWHERE_API_KEY="bw_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
export BUYWHERE_BASE_URL="https://api.buywhere.ai"
```

**Search products across platforms**

```bash
curl -sS --get "$BUYWHERE_BASE_URL/v1/products" \
  -H "Authorization: Bearer $BUYWHERE_API_KEY" \
  --data-urlencode "q=wireless headphones" \
  --data-urlencode "limit=5"
```

**Get a specific product by ID**

```bash
curl -sS "$BUYWHERE_BASE_URL/v1/products/78234" \
  -H "Authorization: Bearer $BUYWHERE_API_KEY"
```

**Deals feed — biggest discounts right now**

```bash
curl -sS --get "$BUYWHERE_BASE_URL/v1/deals" \
  -H "Authorization: Bearer $BUYWHERE_API_KEY" \
  --data-urlencode "min_discount=20" \
  --data-urlencode "limit=10"
```

## MCP Integration

BuyWhere is listed in the awesome-mcp-servers registry. Connect to Claude Desktop, Cursor, Windsurf, or any MCP-compatible AI client in seconds.

**Install the MCP server:**

```bash
pip install httpx mcp
python /path/to/buywhere-api/mcp_server.py
```

**Claude Desktop** — add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "buywhere": {
      "command": "python",
      "args": ["/path/to/buywhere-api/mcp_server.py"],
      "env": {
        "BUYWHERE_API_KEY": "your_api_key_here",
        "BUYWHERE_API_URL": "https://api.buywhere.ai"
      }
    }
  }
}
```

**Cursor** — add to Cursor settings → MCP servers using the same JSON config above.

Available MCP tools: `search_products`, `get_product`, `compare_prices`, `get_deals`, `find_deals`, `browse_categories`, `get_category_products`.

## Documentation

| Resource | Description |
|---|---|
| [API Documentation](docs/API_DOCUMENTATION.md) | Full endpoint reference, authentication, error codes |
| [API Examples](docs/API_EXAMPLES.md) | Worked examples for common agent use cases |
| [Quickstart Guide](docs/QUICKSTART.md) | First query in under 5 minutes |
| [AI Agent Framework Guide](docs/guides/ai-agent-frameworks.md) | LangChain, Claude, and GPT integration patterns for BuyWhere |
| [Developer FAQ](docs/developer-faq.md) | Common auth, search, category, and rate-limit fixes |
| [Release Notes v1.0](docs/release-notes-v1.0.md) | What shipped in the GA release |
| [MCP Setup](MCP.md) | MCP server configuration for AI clients |
| [API Healthcheck Monitor](docs/api-healthcheck-monitor.md) | Synthetic monitoring for `/v1/search` and `/v1/products` |

## Catalog Coverage

| Region | Retailers |
|---|---|
| **Singapore** | Shopee SG, Lazada SG, Amazon SG, Carousell SG, Zalora SG, Qoo10 SG, Courts, Challenger, FairPrice / FairPrice Xtra, Watsons SG, Harvey Norman, Gain City, Popular, Don Don Donki, IKEA SG, Decathlon SG, Uniqlo SG, Sephora SG, and more |
| **Malaysia** | Shopee MY, Lazada MY, Zalora MY, Watsons MY, Carousell MY |
| **Indonesia** | Shopee ID, Tokopedia, Bukalapak, Zalora ID |
| **Thailand** | Shopee TH, Lazada TH, Central TH |
| **Philippines** | Shopee PH, Lazada PH, Zalora PH |
| **Vietnam** | Shopee VN, Tiki, Sendo |
| **United States** | Amazon US, Walmart, Target, Costco, Best Buy, Chewy, Wayfair, Etsy, Ulta, Zappos, REI, and more |
| **Australia** | Amazon AU, Catch, Big W, Bunnings, Coles, Officeworks |
| **Japan / Korea** | Rakuten, Amazon JP, Yodobashi, Daiso JP, Coupang (KR) |

## Rate Limits

| Tier | Key Prefix | Limit | Use Case |
|---|---|---|---|
| Free | `bw_free_*` | 60 req/min | Development and testing |
| Live | `bw_live_*` | 600 req/min | Production |
| Partner | `bw_partner_*` | Unlimited | Data partners |

Rate limit status is returned in response headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`). On `429 Too Many Requests`, use exponential backoff starting at 2 seconds.

## Self-Hosted / Contributing

BuyWhere is a Python/FastAPI service backed by PostgreSQL and Redis, with platform-specific scrapers deployed as ECS Fargate tasks. The scraping pipeline handles 40+ platforms concurrently using distributed Redis locks, NDJSON normalization, and BM25-ranked search via PostgreSQL FTS5.

Architecture details: [SCRAPING_ARCHITECTURE.md](SCRAPING_ARCHITECTURE.md)

```bash
# Local development
docker-compose up
# API available at http://localhost:8000
```

## License

Proprietary — © 2026 BuyWhere. All rights reserved.
