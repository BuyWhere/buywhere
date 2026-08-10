---
slug: "buywhere-mcp-goes-live"
title: "BuyWhere MCP Goes Live: The Open-Source Commerce API for AI Agents"
description: "BuyWhere is live as a production MCP server — 288M+ products, SG/SEA/US markets, one-command install. Here's what it is, why we open-sourced the client, and how to wire it in."
publishedAt: "2026-07-17"
excerpt: "BuyWhere is live as a production MCP server — 288M+ products, SG/SEA/US markets, one-command install. Here's what it is, why we open-sourced the client, and how to wire it in."
tags: ["mcp", "announcement", "open-source", "ecommerce"]
author: "Lyra"
jsonLd:
  "@context": "https://schema.org"
  "@type": "Article"
  headline: "BuyWhere MCP Goes Live: The Open-Source Commerce API for AI Agents"
  datePublished: "2026-07-17"
  author:
    "@type": "Organization"
    name: "BuyWhere"
---

# BuyWhere MCP Goes Live

BuyWhere is now live as a production MCP server. One command gives any MCP-compatible agent the ability to search 288M+ products, compare live prices, and surface deals across Singapore, Southeast Asia, and the United States. This post is the short version: what it is, why we built it, and how to wire it in.

## What it is

BuyWhere is a commerce MCP server. It exposes three core tools that return structured, comparable data:

- **`search_products`** — keyword, category, price-range, and market-filtered search across Shopee, Lazada, Amazon, Walmart, Carousell, Qoo10, and more.
- **`compare_prices`** — side-by-side price and availability for a product across merchants, with a best-value pick.
- **`discover_deals`** — price-dropped and time-limited offers, filterable by market and category.

Every response is a typed object an agent can reason over and pass onward — not prose to parse.

## Why we built it

Agents got good at reasoning over text and code, but they're blind to live commerce. A model will happily hallucinate a price; what it can't do is tell you whether the Sony WH-1000XM5 is cheaper on Shopee or Lazada *right now*, in SGD, in stock. That data is live, fragmented, and behind anti-bot protections. We built the infrastructure — a deduplicated product index, a merchant scraper fleet, a normalization layer — and exposed it as the standard tool surface agents already know how to call.

## Why open-source the client

The MCP client is open source (`@buywhere/mcp-server` on npm, source on GitHub). Open-sourcing the client means:

- **Auditable** — you can read exactly what tools your agent is calling and what data comes back.
- **Self-hostable** — run it where your agent runs, no mystery relay.
- **Composable** — fork and extend; the protocol is standard, your tools can build on ours.

The product index and merchant fleet stay hosted — that's the part that's genuinely expensive to run and where the value compounds — but the interface is open.

## How to wire it in

Three steps, under a minute:

```bash
# 1. Get a free key (no signup, no email)
curl -X POST https://api.buywhere.ai/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"agent_name":"your-agent"}'
# → {"api_key":"bw_...","tier":"unverified","rate_limit":{"daily":1000}}
```

```json
// 2. Add to your MCP client config (Claude Desktop, Cursor, VS Code, Cline, Windsurf, Codex)
{
  "mcpServers": {
    "buywhere": {
      "command": "npx",
      "args": ["-y", "@buywhere/mcp-server"],
      "env": { "BUYWHERE_API_KEY": "bw_..." }
    }
  }
}
```

```text
# 3. Ask your agent
"Find me wireless earbuds under $50 available in Singapore, and compare the top 3."
→ [search_products] → [compare_prices] → structured recommendations with links
```

## What works today

- **288M+ products** deduplicated across SG, SEA, and US markets.
- **Verified clients** for Claude Desktop, Cursor, VS Code Copilot, Cline, Windsurf, OpenCode, Codex, and Continue.dev.
- **Agent-to-Agent (A2A)** protocol support.
- **Free tier**: 1,000 calls/day, no credit card.

## What's next

The commerce layer is live. The next milestones are depth — more merchants, more markets, richer deal detection — and the ecosystem: agents that don't just search and compare but actually complete purchases end-to-end.

If you're building a shopping agent, a price monitor, or a cross-border comparison tool, the infrastructure is ready. Come build on it.

*Get your free key at [buywhere.ai/api-keys](https://buywhere.ai/api-keys). Full API docs at [docs.buywhere.ai](https://docs.buywhere.ai). Source on [GitHub](https://github.com/BuyWhere/buywhere-mcp).*
