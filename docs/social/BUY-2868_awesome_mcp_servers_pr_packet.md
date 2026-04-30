# BUY-2868 PR Packet: Add BuyWhere to awesome-mcp-servers

## Issue
List BuyWhere MCP server on AI agent directories to drive API key signups

## Target
GitHub PR to punkpeye/awesome-mcp-servers

## Status
READY FOR SUBMISSION - Execute on or after scheduled date (Apr 20 per BUY-2681)

## Diff

Insert AFTER this line:
```
- [cmcgrabby-hue/syndicate-links](https://github.com/cmcgrabby-hue/syndicate-links/tree/master/mcp) [![cmcgrabby-hue/syndicate-links MCP server](https://glama.ai/mcp/servers/cmcgrabby-hue/syndicate-links/badges/score.svg)](https://glama.ai/mcp/servers/cmcgrabby-hue/syndicate-links) 📇 🏠 🍎 🪟 🐧 - Affiliate commission infrastructure for AI agents. 7 tools for program discovery, attribution tracking, commission status, and payouts. Search programs, get details, track conversions with signed attribution tokens, and trigger settlement cycles. Install via `npx syndicate-links-mcp`.
```

BEFORE this line:
```
### 🌳 <a name="environment-and-nature"></a>Environment & Nature
```

## Line to Add

```markdown
- [buywhere/buywhere-api](https://github.com/buywhere/buywhere-api) 🐍 ☁️ - Agent-native product catalog API for shopping agents. Search 1.5M+ products, compare prices across Shopee, Lazada, Amazon, and 20+ platforms. Tools for search, product lookup, price comparison, deal discovery, and category browsing. Install via `pip install httpx mcp && python mcp_server.py`.
```

## PR Title

```
Add buywhere/buywhere-api - Agent-native product catalog MCP server for shopping agents 🤖🤖🤖
```

Note: The `🤖🤖🤖` suffix triggers fast-track merging for automated agent PRs per contribution guidelines.

## PR Body

```markdown
## Add BuyWhere MCP Server

BuyWhere is an agent-native product catalog API that provides AI shopping agents with structured product search, price comparison, and deal discovery across 20+ e-commerce platforms.

### What this adds

- **Python-based MCP server** (🐍) with cloud deployment (☁️)
- **7 tools**: search_products, get_product, compare_prices, get_deals, browse_categories, get_category_products, find_best_price
- **1.5M+ products** from Shopee, Lazada, Amazon, Qoo10, Carousell, and more
- **Install**: `pip install httpx mcp && python mcp_server.py`

### Use case

AI agents building shopping workflows can use BuyWhere instead of building and maintaining platform-specific scrapers. The MCP server provides:

- Normalized product data across multiple platforms
- Price comparison and deal discovery
- Category browsing for discovery flows
- Structured responses optimized for agent consumption

### Docs

- MCP Guide: https://api.buywhere.ai/docs/guides/mcp
- Developer Docs: https://api.buywhere.ai/docs
- GitHub: https://github.com/buywhere/buywhere-api
```

## Metadata for Reference

| Field | Value |
|-------|-------|
| Repo | https://github.com/buywhere/buywhere-api |
| Language | Python 🐍 |
| Scope | Cloud ☁️ |
| Category | E-Commerce 🛒 |
| MCP Endpoint | https://api.buywhere.ai/mcp |
| Docs | https://api.buywhere.ai/docs/guides/mcp |
| Website | https://buywhere.ai |

## Execution Checklist

- [ ] Fork punkpeye/awesome-mcp-servers
- [ ] Create branch `add-buywhere-mcp`
- [ ] Add entry to E-Commerce section (after cmcgrabby-hue/syndicate-links)
- [ ] Maintain alphabetical order where applicable
- [ ] Commit with message: "Add buywhere/buywhere-api MCP server for shopping agents"
- [ ] Push branch
- [ ] Create PR with title ending in 🤖🤖🤖
- [ ] Monitor for merge confirmation

## UTM Links for Tracking

Once merged, directory referrals can be tracked via:
- `https://api.buywhere.ai/docs?utm_source=awesomemcp&utm_medium=directory&utm_campaign=buy2868`
- `https://buywhere.ai/api-keys?utm_source=awesomemcp&utm_medium=directory&utm_campaign=buy2868`
