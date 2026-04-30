# BuyWhere JavaScript SDK

> TypeScript SDK for BuyWhere API — Agent-native product catalog API for AI agent commerce

[![npm version](https://badge.fury.io/js/buywhere-js.svg)](https://badge.fury.io/js/buywhere-js)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Install

```bash
npm install buywhere-js
```

Or with yarn:

```bash
yarn add buywhere-js
```

## Requirements

- Node.js 18+ (for native `fetch` and `AbortSignal.timeout`)
- Browser with `fetch` support (modern browsers)

## Quick Start

```typescript
import { BuyWhereClient } from 'buywhere-js';

const client = new BuyWhereClient({ apiKey: 'bw_live_xxxxx' });

// Search for products
const result = await client.search({ query: 'dyson vacuum', limit: 10 });
console.log(`Found ${result.total} products`);
for (const product of result.items) {
  console.log(`${product.title} — ${product.currency} ${product.price} @ ${product.source}`);
}

// Find the cheapest listing
const cheapest = await client.bestPrice('Nintendo Switch OLED');
console.log(`Best price: ${cheapest.price} at ${cheapest.source}`);

// Compare products across platforms
const comparisons = await client.compareProducts('Sony WH-1000XM5');
for (const p of comparisons) {
  console.log(`${p.source}: ${p.currency} ${p.price}`);
}

// Get current deals
const { deals } = await client.getDeals({ min_discount_pct: 20, limit: 10 });
for (const deal of deals) {
  console.log(`${deal.product.title}: ${deal.discount_pct}% off`);
}
```

## API Reference

### `BuyWhereClient`

#### `search(options)`
Full-text product search.

```typescript
const result = await client.search({
  query: 'laptop',
  limit: 20,
  offset: 0,
  category: 'Electronics',
  min_price: 500,
  max_price: 2000,
  source: 'shopee_sg',
});
```

#### `getProduct(id)`
Get a product by BuyWhere ID.

```typescript
const product = await client.getProduct(12345);
console.log(product.title, product.price);
```

#### `bestPrice(query)`
Find the cheapest listing for a product query.

```typescript
const cheapest = await client.bestPrice('iPhone 15 Pro');
console.log(`Best: ${cheapest.price} SGD at ${cheapest.source}`);
```

#### `compareProducts(query)`
Get multiple products for comparison across platforms.

```typescript
const products = await client.compareProducts('PlayStation 5');
```

#### `listCategories()`
List all available categories.

```typescript
const { categories } = await client.listCategories();
for (const cat of categories) {
  console.log(`${cat.name}: ${cat.product_count} products`);
}
```

#### `getDeals(options?)`
Get discounted products.

```typescript
const { deals } = await client.getDeals({
  category: 'Electronics',
  min_discount_pct: 15,
  limit: 20,
});
```

#### `getPriceHistory(productId)`
Get price history for a product.

```typescript
const { price_history } = await client.getPriceHistory(12345);
for (const point of price_history) {
  console.log(`${point.recorded_at}: ${point.price}`);
}
```

#### `trackClick(productId, platform)`
Track an affiliate click.

```typescript
const { tracking_id } = await client.trackClick(12345, 'shopee_sg');
```

## Error Handling

```typescript
import { BuyWhereClient, AuthenticationError, RateLimitError, NotFoundError } from 'buywhere-js';

const client = new BuyWhereClient({ apiKey: 'bw_live_xxxxx' });

try {
  const product = await client.bestPrice('Nonexistent Product');
} catch (error) {
  if (error instanceof NotFoundError) {
    console.log('No products found');
  } else if (error instanceof RateLimitError) {
    console.log('Rate limited - wait and retry');
  } else if (error instanceof AuthenticationError) {
    console.log('Invalid API key');
  } else {
    console.error('API error:', error);
  }
}
```

## Browser Usage

```html
<script type="module">
  import { BuyWhereClient } from 'https://esm.sh/buywhere-js@1';

  const client = new BuyWhereClient({ apiKey: 'bw_live_xxxxx' });
  const result = await client.search({ query: 'laptop' });
  console.log(result.items);
</script>
```

## License

MIT
