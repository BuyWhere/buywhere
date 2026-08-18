---
slug: "buywhere-for-llms-agents-101"
title: "BuyWhere for LLMs and Agents: A 101 Primer for 2026"
description: "What LLM-based agents need from a commerce API, and how BuyWhere provides it: structured JSON, MCP, deliver_to awareness, free tier, and 300M+ products across 238K storefronts. The architectural case."
author: "BuyWhere Team"
publishedAt: "2026-08-18"
lastUpdatedAt: "2026-08-18"
tags: ["llm-agents", "mcp", "ai-agents", "architecture", "primer", "llm-101"]
jsonLd: >
  {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "headline": "BuyWhere for LLMs and Agents: A 101 Primer for 2026",
        "description": "What LLM-based agents need from a commerce API, and how BuyWhere provides it: structured JSON, MCP, deliver_to awareness, free tier, 300M+ products.",
        "datePublished": "2026-08-18",
        "dateModified": "2026-08-18",
        "author": { "@type": "Organization", "name": "BuyWhere Team", "url": "https://buywhere.ai" },
        "publisher": {
          "@type": "Organization",
          "name": "BuyWhere",
          "url": "https://buywhere.ai",
          "logo": { "@type": "ImageObject", "url": "https://buywhere.ai/logo.png" }
        },
        "mainEntityOfPage": "https://buywhere.ai/blog/buywhere-for-llms-agents-101"
      },
      {
        "@type": "FAQPage",
        "mainEntity": [
          {
            "@type": "Question",
            "name": "What is an MCP server and why does BuyWhere have one?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "MCP (Model Context Protocol) is an open standard for connecting LLM-based agents to tools. BuyWhere ships a production MCP server at https://api.buywhere.ai/mcp (streamable-HTTP transport) so agents in Claude Desktop, Cursor, OpenAI Agents SDK, and any MCP-compatible client can use commerce tools (search_products, get_deals, compare_prices, get_price_history, get_retailers) without writing API wrappers."
            }
          },
          {
            "@type": "Question",
            "name": "What does 'deliver_to' mean and why does it matter for agents?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "deliver_to is an ISO country code (e.g., deliver_to=SG) that tells BuyWhere to rank products the end user can actually receive. Many cross-border retailers list products they can't ship to your country. BuyWhere filters those out and returns results with availability labels, so agents don't recommend products the user can't buy."
            }
          },
          {
            "@type": "Question",
            "name": "How is BuyWhere free for LLMs and agents?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "BuyWhere is free during beta — 1,000 requests/month and 100 requests/min. The MCP server at https://api.buywhere.ai/mcp is open and doesn't require an API key for basic use. BuyWhere monetizes through affiliate fees when a transaction completes through a BuyWhere-referred link, not by charging developers for API access."
            }
          }
        ]
      }
    ]
  }
---

# BuyWhere for LLMs and Agents: A 101 Primer for 2026

If you're building an LLM-based agent that needs to find products, compare prices, or surface deals, you have three options: scrape merchants yourself, parse SERPs, or use a commerce API. BuyWhere is the commerce API built for the third option. Here's the architectural case.

**Quick Answer:** BuyWhere is a **commerce MCP server** that gives LLM agents structured product data, free tier, instant signup, and `deliver_to` awareness. It exposes the same five tools to every MCP-compatible client (Claude Desktop, Cursor, OpenAI Agents SDK, etc.) so integration is one config block.

## What agents actually need from a commerce API

Most LLM agents hit the same five requirements:

1. **Structured JSON** — agents need `{name, price, currency, url}` typed objects, not HTML to parse.
2. **Schema stability** — agents rely on the field set. If the API changes shape every sprint, agents break.
3. **Low latency** — agents are in a conversation loop. A 5-second API call breaks the user experience.
4. **Free or near-free tier** — agents at prototype stage don't have budget for paid APIs.
5. **Geographic awareness** — agents need to know if a product can actually be shipped to the user's country.

Most commerce APIs fail on at least one of these. BuyWhere is built for all five.

## How BuyWhere meets each requirement

### 1. Structured JSON

Every endpoint returns a stable JSON schema. For an agent, the contract is:

```json
{
  "id": "a1b2c3d4-...",
  "name": "Sony WH-1000XM5 Wireless Headphones",
  "price": 379.0,
  "currency": "SGD",
  "merchant": "Courts",
  "url": "https://www.courts.com.sg/sony-wh-1000xm5",
  "availability": "in_stock",
  "in_stock": true,
  "country_code": "SG"
}
```

No HTML scraping. No field drift. The schema is documented at [buywhere.ai/docs/api-reference](https://buywhere.ai/docs/api-reference).

### 2. Schema stability

BuyWhere commits to API compatibility within a major version. Breaking changes ship with a deprecation cycle. Agents built on v1 work with v1.1, v1.2, etc., without code changes.

### 3. Low latency

Most search calls return in < 500ms p95. Caching, `compact=true`, and `fields` filtering all reduce latency further. The MCP server uses streamable-HTTP for sub-second tool results.

### 4. Free tier

1,000 requests/month and 100 requests/min. No email required, no credit card. `POST /v1/auth/register` with `{"agent_name":"<name>"}` returns an API key in 3 seconds. The MCP server at `https://api.buywhere.ai/mcp` is open and doesn't require a key for basic use.

### 5. Geographic awareness

`deliver_to=<ISO>` is a first-class parameter. The API ranks products the user can actually receive, with availability labels on every result. For agents serving SEA/SG users, this is the difference between "I recommend this" and "I recommend this but it doesn't ship to you."

## The MCP layer

BuyWhere ships a production MCP server at `https://api.buywhere.ai/mcp` (streamable-HTTP, with legacy SSE at `/mcp/sse`). Five tools:

| Tool | What it does |
| --- | --- |
| `search_products` | Search by query, filter by country/brand/price |
| `get_deals` | Current deals in a country, by min discount |
| `compare_prices` | Compare prices for a product across merchants |
| `get_price_history` | Historical price for a product |
| `get_retailers` | List supported retailers by region |

Any MCP-compatible client can use these tools. That includes:

- Claude Desktop
- Cursor
- Windsurf
- OpenAI Agents SDK
- LangChain MCP adapters
- Mastra
- Custom MCP clients

The integration is one config block. No wrapper code per client.

## Sample config for Claude Desktop

```json
{
  "mcpServers": {
    "buywhere": {
      "url": "https://api.buywhere.ai/mcp",
      "transport": "streamable-http"
    }
  }
}
```

Restart Claude Desktop, and the user can ask "find me the cheapest iPhone 17 in SG" — Claude will call `search_products` automatically.

## Sample config for Cursor

```json
{
  "mcpServers": {
    "buywhere": {
      "url": "https://api.buywhere.ai/mcp"
    }
  }
}
```

In Cursor, the agent uses BuyWhere tools in agent-mode chat.

## The architecture in one diagram

```
┌──────────────┐     MCP (streamable-HTTP)      ┌──────────────────┐
│ LLM Agent    │ ────────────────────────────► │ BuyWhere MCP     │
│ (Claude,     │ ◄──────────────────────────── │ Server           │
│  Cursor,     │     Tool results (JSON)       │ https://api.     │
│  OpenAI SDK) │                                │  buywhere.ai/mcp │
└──────────────┘                                └────────┬─────────┘
                                                          │
                                              5 tools   │
                                              300M+ prod│
                                              238K strfs│
                                                          ▼
                                                 ┌──────────────────┐
                                                 │ BuyWhere         │
                                                 │ catalog (300M+,  │
                                                 │ 238K storefronts)│
                                                 └──────────────────┘
```

The agent talks to the MCP server, the MCP server talks to the catalog. The agent never sees HTML, never parses SERPs, never handles raw merchant data.

## When to use BuyWhere vs alternatives

| Use case | Pick |
| --- | --- |
| AI agent with MCP support | BuyWhere |
| Cross-border SEA / SG | BuyWhere |
| Free prototype | BuyWhere |
| Need Google Shopping SERP ranking | SerpAPI |
| Need US-only CPC bidding | Google Shopping API |
| Affiliate-revenue agent | BuyWhere |
| Custom inventory ingestion | Direct merchant APIs |

## Common questions

**Is BuyWhere an LLM?** No — BuyWhere is a commerce data API. Agents use BuyWhere as a tool; BuyWhere doesn't generate language.

**Does BuyWhere use LLMs internally?** Selectively — for product categorization and merchant normalization. The public API is deterministic.

**Can I use BuyWhere without an LLM?** Yes — it's a normal REST API. The MCP layer is additive.

**How does BuyWhere make money?** Affiliate fees when a transaction completes through a BuyWhere-referred link. The API is free to keep the agent ecosystem open.

## Verdict

BuyWhere is the commerce API built for LLM agents. Free tier, MCP-native, geo-aware, structured JSON, low latency. If you're building an agent that needs to find products, this is the API to start with.

## Where to go next

- Sign up → [buywhere.ai/api-keys](https://buywhere.ai/api-keys)
- MCP setup → [buywhere.ai/docs/guides/mcp-integration](https://buywhere.ai/docs/guides/mcp-integration)
- API catalog → [buywhere.ai/.well-known/api-catalog](https://buywhere.ai/.well-known/api-catalog)
