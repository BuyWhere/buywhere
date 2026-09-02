---
slug: "buywhere-cursor-plugin-launch"
title: "BuyWhere for Cursor: AI-Powered Product Search Now in Your Code Editor"
description: "Shop smarter without leaving your code editor. BuyWhere brings AI-powered product search and price comparison directly into Cursor with a one-click npm install."
author: "BuyWhere Team"
publishedAt: "2026-06-16"
tags: ["cursor", "plugin", "product search", "price comparison", "shopping", "mcp", "ai"]
jsonLd: >
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": "BuyWhere for Cursor: AI-Powered Product Search Now in Your Code Editor",
    "description": "BuyWhere brings AI-powered product search and price comparison directly into Cursor with a one-click npm install.",
    "datePublished": "2026-06-16",
    "dateModified": "2026-06-16",
    "author": { "@type": "Organization", "name": "BuyWhere Team", "url": "https://buywhere.ai" },
    "publisher": {
      "@type": "Organization",
      "name": "BuyWhere",
      "url": "https://buywhere.ai",
      "logo": { "@type": "ImageObject", "url": "https://buywhere.ai/logo.png" }
    },
    "mainEntityOfPage": "https://buywhere.ai/blog/buywhere-cursor-plugin-launch"
  }
---

# BuyWhere for Cursor: AI-Powered Product Search Now in Your Code Editor


Shop smarter without leaving your code editor. BuyWhere brings AI-powered product search and price comparison directly into Cursor — so you can compare prices across Amazon, Walmart, Best Buy, Target, and thousands of other retailers without opening a browser tab.

---

## One-Click Setup. Thousands of Retailers. Zero Friction.

Getting started takes under a minute:

```bash
npm install -g @buywhere/buywhere-cursor
```

That's it. The plugin auto-configures itself in Cursor's MCP settings file (`~/.cursor/mcp.json`). Restart Cursor and BuyWhere is live — no manual configuration, no API key hunting, no credentials to copy.

---

## How BuyWhere Works in Cursor

BuyWhere wraps the open-source [BuyWhere MCP server](https://github.com/buywhere/mcp-server) (`@buywhere/mcp-server`) using the Model Context Protocol. Once installed, four tools are immediately available in any Cursor conversation:

| Tool | What it does |
|------|-------------|
| `search_products` | Full-text search across 1.5M+ products from 20+ retailers |
| `compare_prices` | Side-by-side price comparison across all merchants |
| `get_price_history` | 90-day price charts to spot the right buy window |
| `get_price_alerts` | Set smart alerts and get notified when prices drop |

Just mention `@BuyWhere` in any Cursor chat and type what you're looking for.

---

## What You Can Do with BuyWhere

- **Universal product search** across 10,000+ retailers and every major US/SEA e-commerce platform
- **Real-time price comparison** so you always know you're getting the best deal
- **90-day price history** to avoid buying at a peak and spot genuine discounts
- **Smart price drop alerts** delivered to your cursor session — no more manually checking back
- **Stock availability checking** across multiple merchants in one query
- **Free to install and use** — the plugin is free; you pay for the BuyWhere API calls you actually make

---

## Example Prompts

```
@BuyWhere Find me a 4K monitor under $400 with USB-C and at least 27 inches
@BuyWhere Compare GPU prices for the RTX 4070 across all retailers — who's cheapest right now?
@BuyWhere What's the price history for the MacBook Air M3 over the last 90 days?
@BuyWhere Alert me when the Sony WH-1000XM5 drops below $250
@BuyWhere Is this product cheaper on Shopee or Lazada right now?
```

---

## Built on BuyWhere MCP

The Cursor plugin is a thin, zero-config wrapper around [`@buywhere/mcp-server`](https://www.npmjs.com/package/@buywhere/mcp-server) — the same open-source MCP server powering product search across the entire BuyWhere platform. Whether you're in Cursor, Claude Desktop, Cline, Windsurf, or any other MCP-compatible editor, BuyWhere works the same way.

The underlying BuyWhere API covers 7 countries, 20+ merchant integrations, and 11M+ indexed products — giving AI agents and developers a reliable, normalized product data layer without the merchant-by-merchant scraping nightmare.

---

## Get Started Now

Install the plugin and start shopping smarter today:

```bash
npm install -g @buywhere/buywhere-cursor
```

Then restart Cursor and try `@BuyWhere search for [your product]`.

**Links:**
- npm package: [ @buywhere/buywhere-cursor](https://www.npmjs.com/package/@buywhere/buywhere-cursor) *(pending — see distribution plan)*
- GitHub: [ buywhere/buywhere-cursor](https://github.com/buywhere/buywhere-cursor) *(pending — package must be published first)*
- BuyWhere main site: [ buywhere.ai](https://buywhere.ai)
- MCP Server: [ @buywhere/mcp-server on npm](https://www.npmjs.com/package/@buywhere/mcp-server)

---

## Distribution Plan

> **⚠️ Blocker:** `@buywhere/buywhere-cursor` is **not yet published to npm**. The Cursor plugin package must be published before this blog can go live with functional install instructions. Smithery namespace status: see [BUY-14359](/BUY/issues/BUY-14359).

| Channel | Status | Notes |
|---------|--------|-------|
| BuyWhere blog (this post) | Draft | Awaiting npm package publish |
| Dev.to | Pending | Technical post on MCP plugin development |
| Twitter/X | Pending | Launch announcement with demo GIF |
| LinkedIn | Pending | Post targeting developers/productivity enthusiasts |
| Reddit | Pending | r/SideProject, r/cursor_ai, r/ChatGPT |
| Newsletter | Pending | Direct to BuyWhere list once marketplace live |
| Smithery.ai | **Blocked** | Namespace unclaimed — needs buywhere GitHub org verification |
| Cursor Marketplace | **Pending** | Requires publisher account setup |
| VSCode Marketplace | **Not submitted** | Needs .vsix + publisher account |
| OpenVSX | **Not submitted** | API publish via GitHub OAuth |
| GitHub Marketplace | **Not submitted** | GitHub Actions + listing |

**Smithery namespace claim path:** The `buywhere` namespace on Smithery shows the BuyWhere MCP (`buywhere`) as unclaimed. Claiming requires proving ownership of the `buywhere` GitHub organization. This must be resolved before claiming can proceed.
