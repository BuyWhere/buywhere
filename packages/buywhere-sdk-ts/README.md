# BuyWhere TypeScript SDK

Official TypeScript SDK for the BuyWhere Agent-Native Product Catalog API.

## Installation

```bash
npm install @buywhere/sdk
# or
yarn add @buywhere/sdk
# or
pnpm add @buywhere/sdk
```

## Quick Start

```typescript
import { BuyWhereClient } from "@buywhere/sdk";

const client = new BuyWhereClient("bw_live_xxxxx");

// Search products
const results = await client.search({ q: "iphone 15 pro" });
console.log(`Found ${results.total} products`);

// Find best price
const best = await client.bestPrice("iphone 15 pro 256gb");
console.log(`Cheapest: ${best.name} at ${best.price} ${best.currency}`);

// Get deals
const deals = await client.deals({ min_discount_pct: 20 });
console.log(`${deals.total} deals found`);
```

## Features

- Full TypeScript support with type definitions
- Automatic retry with exponential backoff
- Rate limit handling
- API key authentication
- All API endpoints covered

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `health()` | GET /health | Health check |
| `apiInfo()` | GET /v1 | API root info |
| `changelog()` | GET /v1/changelog | API changelog |
| `search()` | GET /v1/search | Full-text product search |
| `bestPrice()` | GET /v1/products/best-price | Find cheapest product |
| `compare()` | GET /v1/products/compare | Compare product across platforms |
| `compareProducts()` | POST /v1/products/compare | Compare multiple products |
| `compareProductsDiff()` | POST /v1/products/compare/diff | Field-level product diff |
| `trending()` | GET /v1/products/trending | Get trending products |
| `getProduct()` | GET /v1/products/:id | Get product by ID |
| `exportProducts()` | GET /v1/products/export | Bulk export products |
| `categories()` | GET /v1/categories | List categories |
| `deals()` | GET /v1/deals | Find discounted products |
| `ingest()` | POST /v1/ingest/products | Batch ingest products |

## Error Handling

```typescript
import {
  BuyWhereClient,
  AuthenticationError,
  RateLimitError,
  NotFoundError,
} from "@buywhere/sdk";

const client = new BuyWhereClient("bw_live_xxxxx");

try {
  const product = await client.getProduct(12345);
} catch (error) {
  if (error instanceof NotFoundError) {
    console.log("Product not found");
  } else if (error instanceof RateLimitError) {
    console.log("Rate limited, retry later");
  } else if (error instanceof AuthenticationError) {
    console.log("Invalid API key");
  }
}
```

## Retry Configuration

```typescript
const client = new BuyWhereClient("bw_live_xxxxx", {
  maxRetries: 5,
  retryDelay: 1000,
  backoffMultiplier: 2,
  timeout: 60000,
});
```

## License

MIT
