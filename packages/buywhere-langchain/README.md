# @buywhere/langchain

BuyWhere product search, price comparison, and deals as LangChain tools — drop-in tools for AI agents built with LangChain.js.

```bash
npm install @buywhere/langchain
```

## Quick Start

```typescript
import { SearchProductsTool, ComparePricesTool, GetDealsTool } from "@buywhere/langchain";

// Class-based tools (legacy)
const searchTool = new SearchProductsTool({ apiKey: process.env.BUYWHERE_API_KEY! });
const compareTool = new ComparePricesTool({ apiKey: process.env.BUYWHERE_API_KEY! });
const dealsTool = new GetDealsTool({ apiKey: process.env.BUYWHERE_API_KEY! });

// Bind to a LangChain agent or model
const tools = [searchTool, compareTool, dealsTool];
```

## Tool Types

### Class-based Tools (LangChain `Tool`)

| Tool | Description |
|------|-------------|
| `SearchProductsTool` | Natural-language product search with price/country filters |
| `ComparePricesTool` | Find cheapest price for a product across merchants |
| `GetDealsTool` | Top deals sorted by discount percentage |
| `GetProductDetailsTool` | Full product details by BuyWhere product ID |
| `GetPriceHistoryTool` | Price history chart for a product |
| `AgentSearchProductsTool` | Agent-optimized search with compact output |
| `ResolveProductQueryTool` | Resolve product name → canonical BuyWhere product |
| `FindBestPriceTool` | Find best price for a specific product |
| `CompareProductsTool` | Side-by-side comparison of 2–10 products |
| `GetPurchaseOptionsTool` | All purchase options for a product |

### Typed Tools (LangChain `DynamicStructuredTool`)

Schema-typed variants with Zod validation for structured tool calling:

```typescript
import { createSearchProductsTool, createStructuredTools } from "@buywhere/langchain";

// Single typed tool
const search = createSearchProductsTool({ apiKey: process.env.BUYWHERE_API_KEY! });
await search.invoke({ query: "sony wh-1000xm5", country: "SG", limit: 10 });

// All typed tools at once
const tools = createStructuredTools({ apiKey: process.env.BUYWHERE_API_KEY! });
```

| Typed Tool | Input Schema |
|------------|-------------|
| `createSearchProductsTool` | `query`, `country`, `limit`, `price_min`, `price_max` |
| `createGetProductDetailsTool` | `product_id` (number) |
| `createGetPriceComparisonTool` | `query`, `category`, `limit` |

## Agent Tools

High-level tool sets for agentic use cases:

```typescript
import { createBuyWhereTools, createAgentTools } from "@buywhere/langchain";

// Full tool suite for general agents
const agentTools = createBuyWhereTools({ apiKey: process.env.BUYWHERE_API_KEY! });

// Compact agent tools with minimal payload
const structured = createStructuredTools({ apiKey: process.env.BUYWHERE_API_KEY! });
```

## Configuration

```typescript
const config: BuyWhereLangChainConfig = {
  apiKey: process.env.BUYWHERE_API_KEY!,
  region: 'sea',           // 'us' | 'sea' (default: 'sea')
  defaultCountry: 'SG',    // 'SG' | 'MY' | 'TH' | 'PH' | 'VN' | 'ID' | 'US'
};
```

## Retry Behavior

All tools use exponential backoff (3 retries, 200ms base, 5s max). Network errors are surfaced as JSON with `success: false`.

## Requirements

- Node.js 18+
- LangChain.js `^0.3.80`
- A BuyWhere API key ([get one](https://buywhere.ai))
