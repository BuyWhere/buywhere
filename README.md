# BuyWhere API

The product catalog API for AI agent commerce — search, compare, and track prices across 900,000+ merchants in the US and Southeast Asia.

## Overview

BuyWhere is an agent-native product catalog API indexing 300M+ products from 900,000+ merchants across Singapore, Malaysia, Indonesia, Thailand, the Philippines, Vietnam, and the United States. It is purpose-built for AI shopping agents: BM25-ranked search, structured price comparison, deals discovery, and affiliate link tracking out of the box. The API is MCP-compatible and works with Claude Desktop, Cursor, LangChain, CrewAI, and any MCP-enabled AI client.

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

## 🏆 Build With BuyWhere Challenge — Win $1,188 in API Credits

Build an AI agent using BuyWhere MCP tools and win API credits, featured placement, and a Built With BuyWhere badge.

**Tools:** `search_products`, `get_product`, `compare_prices`, `find_deals`, `browse_categories`, `get_category_products`, `get_deals`

**Timeline:** Submissions open through May 19, 2026

**[Enter the Challenge →](https://buywhere.ai/challenge)** | [Quick Start](https://buywhere.ai/challenge#quick-start) | [MCP Setup](#mcp-integration)

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

## Semantic Search & Embeddings (BUY-76567 — 60-day plan)

BuyWhere uses hybrid search (BM25 keyword + vector cosine similarity via RRF) as the default search mode. Embeddings are built with **Qwen3-Embedding-4B** (1024-dim) via Flow AI, replacing the retired Gemini pipeline.

### Model & Budget

| Item | Detail |
|---|---|
| **Model** | `flow-embed-1` (Qwen3-Embedding-4B, open weights, 1024-dim) |
| **Provider** | Flow AI (`POST https://api.flowaiapi.com/v1/embeddings`) |
| **Failover** | DeepInfra primary → SiliconFlow (Flow routes automatically) |
| **Cost** | $0.02/M tokens ($0.01 batch); one-off backfill ~$10; ongoing ~$20–26/mo |
| **Budget** | $10 one-off + $25/month, hard cap enforced by Flow AI key |

### Schedule (28 Aug → 27 Oct 2026)

| Phase | Dates | Deliverable |
|---|---|---|
| **Decide & guard** | Days 0–7 | Pin model/dim, eval set, nightly backup to R2, write-access lock |
| **Feature first** | Days 8–21 | Hybrid as default mode in `/v1/products/search` and MCP `search` |
| **Backfill** | Days 22–28 | One worker, hash-gated, checkpointed, hard cap = scope size |
| **Matching** | Days 29–45 | ANN candidates → rule verification → `product_matches` populated |
| **Measure** | Days 46–60 | Dashboard: coverage, vector-path share, p95, eval win rate, multi-merchant % |

### Kill Criteria (Day 60)

- Hybrid doesn't beat keyword on the 200-query eval set → switch off
- Matching doesn't lift multi-merchant coverage → keep vectors, pause matching

### Key Rules

- ALL embedding calls go through Flow AI only — never DeepInfra/Gemini/SiliconFlow directly
- Scope = in-stock AND price > 0 products only (~8M of 115M total)
- Only the embed worker may write to `product_embeddings` (write-access lock enforced)
- Nightly `pg_dump` of `product_embeddings` → R2 (30-day retention)
- `model_ver = 'flow-embed-1@1024'` stamped on every vector

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
