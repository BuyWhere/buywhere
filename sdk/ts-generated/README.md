# BuyWhere TypeScript SDK (Auto-Generated)

> Auto-generated TypeScript client for the BuyWhere product catalog API.

This SDK is automatically generated from the OpenAPI specification. It provides type-safe access to all BuyWhere API endpoints.

## Installation

```bash
npm install @buywhere/ts-generated
```

## Usage

```typescript
import { BuyWhere, ProductsService, SearchService } from '@buywhere/ts-generated';

// Initialize the client
const client = new BuyWhere({
  basePath: 'https://api.buywhere.ai',
  apiKey: 'your-api-key',
});

// Search for products
const searchResults = await client.search.search({
  q: 'dyson vacuum',
  limit: 10,
});

// Get product details
const product = await client.products.getProduct(12345);

// Compare prices
const comparison = await client.products.compareProducts({
  productIds: [12345, 67890],
});

// Get deals
const deals = await client.deals.getDeals({
  minDiscount: 20,
  limit: 20,
});
```

## Generating the SDK

If you need to regenerate the SDK from the OpenAPI spec:

```bash
# Install dependencies
npm install

# Fix any missing schema references (if needed)
node fix-spec.js

# Generate the TypeScript client
npx ts-node src/scripts/generate.ts

# Or use the npm script
npm run generate
```

## Architecture

```
ts-generated/
├── core/           # Core HTTP client and utilities
├── models/         # TypeScript type definitions
├── services/       # API service clients
├── index.ts        # Main exports
├── BuyWhere.ts     # Client class
└── fix-spec.js     # Schema fix utility
```

## API Coverage

- **Products**: Search, get, compare, track
- **Categories**: List and browse
- **Deals**: Discounted products
- **Ingestion**: Product data ingestion
- **System**: Health, status, changelog

## License

MIT