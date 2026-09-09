---
title: "BuyWhere — Product Hunt Launch Copy"
slug: "buywhere-product-hunt-launch"
description: "Official Product Hunt launch copy for BuyWhere — the AI agent for real-time product price comparison across US and Singapore retailers."
category: "Social Launch"
tags:
  - "product hunt"
  - "launch"
  - "mcp"
  - "shopping agent"
  - "price comparison"
published: true
---

# BuyWhere — Product Hunt Launch Copy

## Tagline
**The AI agent that finds you the best prices across every retailer.**

## Gallery Images
1. **Hero screenshot**: BuyWhere search showing live price comparison across Amazon, Best Buy, Walmart, Target for a MacBook Pro
2. **API demo**: Terminal showing MCP server tools being invoked (search_products, compare_prices, find_best_price)
3. **Price comparison table**: Screenshot of the live comparison view showing retailer x price x availability
4. **Developer setup**: Code snippet showing BuyWhere MCP server integration in under 5 lines of TypeScript

## Video URL
https://buywhere.ai/demo (placeholder — insert demo video)

## Promotional Links
- **Live product**: https://buywhere.ai
- **Documentation**: https://buywhere.ai/developers
- **API Reference**: https://buywhere.ai/pages/api-reference

## 1-Line Description
Compare product prices across Amazon, Best Buy, Walmart, Shopee, Lazada, and 500+ more retailers with one API call or voice command.

## Short Description
BuyWhere is an AI-native product price comparison API and MCP server. Tell your AI agent "find me the cheapest MacBook Pro" — it queries 500+ retailers and returns live prices in seconds. Built for AI agents, shopping assistants, deal hunters, and developers.

## Thumbnail Image URL
https://buywhere.ai/og-image.png (placeholder)

## Hunter
@buywhere (placeholder — add actual hunter username)

## Vendor
BuyWhere

## Made With
- TypeScript
- Node.js
- MCP (Model Context Protocol)

---

## Campaign Copy

### The Problem

You're building an AI agent. It recommends products. But when a user asks "where should I buy this?" — your agent draws a blank. It can't see prices.

Existing solutions:
- **Honey** — browser extension for coupons; no API, no AI agent support
- **CamelCamelCamel** — Amazon only; no MCP, no real-time data
- **Keepa** — Amazon only; price charts but no agent integration
- **Google Shopping** —隔 Consumer tool; no structured API for AI agents

### The Solution

BuyWhere gives your AI agent **real-time access to product pricing across 500+ retailers** via:
1. **REST API** — `/v1/products/search`, `/v1/compare-prices`, `/v1/price-history`
2. **MCP Server** — `search_products`, `compare_prices`, `find_best_price`, `track_price`, `get_merchant_info`
3. **Multi-country** — US (Amazon, Best Buy, Walmart, Target, Costco, Newegg) + Singapore (Shopee, Lazada, Courteney)

### How It Works

```typescript
// Install the MCP server
npm install @buywhere/mcp-server

// Configure in Claude Desktop, Cursor, or any MCP client
// Then ask naturally:
"Find me the cheapest Sony WH-1000XM5 headphones
 across Amazon, Best Buy, and Walmart in Singapore."

// BuyWhere returns live prices from all three retailers
// Your agent picks the best deal and links directly to the product
```

### Features

- **500+ retailers** — Amazon, Best Buy, Walmart, Target, Costco, Newegg, B&H Photo, Shopee, Lazada, Courteney
- **120,000+ products** — Live pricing data updated continuously
- **Multi-country** — US (USD) and Singapore (SGD) supported
- **MCP native** — Works with Claude Desktop, Cursor, Windsurf, and any MCP-compatible AI
- **REST API** — Clean REST endpoints for custom integrations
- **Price history** — Track price changes over time to find the best buying moment
- **Merchant info** — Ratings, return policies, shipping options for every retailer

### Developer-First Design

| Feature | Free | Developer ($29/mo) | Business ($99/mo) |
|---------|------|---------------------|-------------------|
| API calls/month | 1,000 | 50,000 | 500,000 |
| MCP server access | Yes | Yes | Yes |
| Price history | No | Yes | Yes |
| Priority support | No | No | Yes |

### Live Demo

Search for any product at [buywhere.ai/search](https://buywhere.ai/search) — see live prices from multiple retailers side-by-side.

### Technical Setup

```bash
# Option 1: Install via npm
npm install @buywhere/mcp-server

# Option 2: Install via Smithery
npx @smithery-ai/cli install @buywhere/mcp-server

# Configure in your MCP client
# env.BUYWHERE_API_KEY=your-api-key
```

### FAQ

**Q: Which AI agents support BuyWhere MCP?**
A: Any MCP-compatible agent — Claude Desktop, Cursor, Windsurf, Cobrowse, and more. We're MCP-native, not a browser extension.

**Q: How is this different from Honey?**
A: Honey is a browser extension for coupon codes. BuyWhere is an API + MCP server for real-time price comparison. We're building for AI agents, not browsers.

**Q: Does this work outside the US?**
A: Yes — we support US (Amazon, Best Buy, Walmart, Target, Costco, Newegg, B&H Photo) and Singapore (Shopee, Lazada, Courteney). More countries coming.

**Q: How often is pricing data updated?**
A: Live — we query retailer APIs and scrapers in real-time. No cached stale prices.

**Q: Can I track price changes?**
A: Yes — the Developer and Business plans include price history data for trend analysis.

---

## Comments for Discussion

> We built BuyWhere because our AI shopping assistant couldn't answer the most basic question: "where should I buy this?" Existing price APIs were either consumer-only, Amazon-only, or had no AI agent support. So we built the API we wished existed.

> Fun fact: the MCP protocol makes this incredibly natural — your agent doesn't need to know about our API. You just tell it what you want, and BuyWhere handles the rest.

---

## Related Links
- [Documentation](https://buywhere.ai/developers)
- [API Reference](https://buywhere.ai/pages/api-reference)
- [GitHub](https://github.com/buywhere)
- [Twitter/X](https://twitter.com/buywhere)
