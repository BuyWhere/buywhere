# @buywhere/sdk

Official TypeScript/JavaScript SDK for BuyWhere product search, compare, price history, key rotation, and webhooks.

## Installation

```bash
npm install @buywhere/sdk
```

## Quick start

```ts
import { createClient } from '@buywhere/sdk';

const client = createClient('bw_live_your_api_key');

const results = await client.search.search('wireless headphones', {
  country: 'US',
  limit: 5,
});

const comparison = await client.compare(['sku_123', 'sku_456']);
const history = await client.priceHistory('sku_123', {
  limit: 30,
  since: '2026-01-01T00:00:00Z',
});

const webhook = await client.webhooks.create(
  'https://example.com/webhooks/buywhere',
  ['price_drop', 'product_update'],
);

console.log(results.items.length, comparison.products.length, history.price_history.length, webhook.id);
```

## Configuration

```ts
import { BuyWhereSDK } from '@buywhere/sdk';

const client = new BuyWhereSDK({
  apiKey: 'bw_live_your_api_key',
  baseUrl: 'https://api.buywhere.ai',
  timeout: 30000,
  defaultCurrency: 'USD',
  defaultCountry: 'US',
  retry: {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
  },
});
```

## v0.2.0 methods

```ts
import type {
  CompareResponse,
  PriceHistoryResponse,
  RotateApiKeyResponse,
  Webhook,
} from '@buywhere/sdk';

const client = createClient('bw_live_your_api_key');

const compareResult: CompareResponse = await client.compare(['sku_123', 'sku_456']);

const historyResult: PriceHistoryResponse = await client.priceHistory('sku_123', {
  limit: 14,
  since: '2026-04-01T00:00:00Z',
});

const rotation: RotateApiKeyResponse = await client.rotateApiKey();

const createdWebhook = await client.webhooks.create(
  'https://example.com/webhooks/buywhere',
  ['price_drop'],
);

const webhooks: Webhook[] = await client.webhooks.list();
await client.webhooks.delete(createdWebhook.id);
```

The existing namespaced helpers still work:

```ts
const categoryComparison = await client.compare.compareByCategory('electronics');
const product = await client.products.getProduct(12345);
const deals = await client.deals.getDeals({ country: 'US', limit: 10 });
```

## Error handling

```ts
import { BuyWhereError, createClient } from '@buywhere/sdk';

const client = createClient('bw_live_your_api_key');

try {
  await client.compare(['sku_123', 'sku_456']);
} catch (error) {
  if (error instanceof BuyWhereError) {
    console.error(error.statusCode);
    console.error(error.errorCode);
    console.error(error.requestId);
    console.error(error.message);
  }
}
```

`BuyWhereError` normalizes the API error payload into:

- `statusCode`
- `errorCode`
- `requestId`
- `message`

## Module formats

The package ships dual ESM + CJS builds with typed exports:

```ts
import { createClient } from '@buywhere/sdk';
```

```js
const { createClient } = require('@buywhere/sdk');
```

## Development

```bash
npm run build
npm test
```
