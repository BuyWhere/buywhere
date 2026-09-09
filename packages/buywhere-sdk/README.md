# @buywhere/sdk

<p align="left">
  <a href="https://buywhere.ai/api-keys"><img src="https://img.shields.io/badge/🔑_Get_your_free_API_key-60_seconds-4f46e5?style=for-the-badge" alt="Get your free API key"></a>
</p>

Official TypeScript/JavaScript SDK for BuyWhere product search, semantic agent search, compare, price history, autocomplete, deals, key rotation, and webhooks — with built-in circuit breaker and retry resilience.

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
const deals = await client.deals.getDeals({ country: 'US', limit: 10 });

console.log(results.items.length, comparison.products.length, history.price_history.length, deals.items.length);
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

## Compare, price history & deals

```ts
import type {
  CompareResponse,
  PriceHistoryResponse,
} from '@buywhere/sdk';

const client = createClient('bw_live_your_api_key');

const compareResult: CompareResponse = await client.compare(['sku_123', 'sku_456']);

const historyResult: PriceHistoryResponse = await client.priceHistory('sku_123', {
  limit: 14,
  since: '2026-04-01T00:00:00Z',
});
```

The existing namespaced helpers still work:

```ts
const categoryComparison = await client.compare.compareByCategory('electronics');
const product = await client.products.getProduct(12345);
const deals = await client.deals.getDeals({ country: 'US', limit: 10 });
```

## Not available yet (BUY-70872)

These methods exist in the type surface but have **no deployed API route**. They throw
`BuyWhereError` with status `501` rather than issuing a request that would 404:

| Method | Why | Use instead |
| --- | --- | --- |
| `client.rotateApiKey()` | `/v1/keys/{id}/rotate` never deployed | `POST /v1/keys` to mint a replacement key |
| `client.webhooks.create/list/delete()` | no customer-facing `/v1/webhooks` API | poll `client.deals.getDeals()` / `client.search.search()` |
| `client.products.getAlerts()` | `/v1/products/{id}/alerts` never deployed | poll `client.products.getPriceHistory()` |
| `client.products.getReviewsSummary()` | `/v1/products/{id}/reviews/summary` never deployed | — |
| `client.deals.getDealsFeed()` | `/v1/deals/feed` never deployed (BUY-70605) | `client.deals.getDeals()` |

They will be removed in the next major version, or re-enabled if the routes ship.

## Agent search (semantic)

The `agents` namespace provides semantic search via the `/v2/agents/search` endpoint, with automatic fallback to full-text search when the circuit breaker is open:

```ts
import type { AgentSearchResponse } from '@buywhere/sdk';

const client = createClient('bw_live_your_api_key');

// Simple query
const results: AgentSearchResponse = await client.agents.search('wireless headphones');

// With filters
const filtered = await client.agents.search({
  q: 'mechanical keyboard',
  limit: 10,
  min_price: 50,
  max_price: 200,
  sort_by: 'price_asc',
  currency: 'USD',
  include_agent_insights: true,
  include_price_history: true,
});

console.log(filtered.results.length, filtered.total, filtered.query_time_ms);
```

Supported `AgentSearchParams`:

- `q` (required) — search query
- `limit`, `offset`, `cursor` — pagination
- `source`, `platform` — filter by data source or platform
- `min_price` / `max_price` — price range
- `availability` — in-stock only
- `sort_by` — `relevance`, `price_asc`, `price_desc`, `newest`, `highest_rated`, `most_reviewed`
- `currency` — display currency
- `include_agent_insights`, `include_price_history`, `include_availability_prediction` — enriched response fields

## Autocomplete

The `autocomplete` namespace provides type-ahead product suggestions with optional debouncing for UI integration:

```ts
import type { AutocompleteResult } from '@buywhere/sdk';

const client = createClient('bw_live_your_api_key');

// Direct call
const suggestions: AutocompleteResult = await client.autocomplete.autocomplete('iph', {
  limit: 8,
  country: 'US',
});

// Debounced (cancels in-flight requests automatically)
const debounced = await client.autocomplete.debouncedAutocomplete('iphone', 300, {
  country: 'US',
});

console.log(suggestions.items.map(s => s.name));
```

> **Tip:** Call `client.autocomplete.destroy()` on unmount to clean up pending timers and requests.

## Circuit breaker & resilience

The SDK includes a built-in circuit breaker that protects against cascading failures. When the semantic search endpoint repeatedly fails, the breaker opens and automatically falls back to the FTS search path:

```ts
import { CircuitBreaker, CircuitBreakerError } from '@buywhere/sdk';

// The circuit breaker is configured per-client via the ClientConfig:
const client = new BuyWhereSDK({
  apiKey: 'bw_live_your_api_key',
  circuitBreaker: {
    failureThreshold: 3,      // open after 3 failures
    resetTimeoutMs: 60000,    // try half-open after 60s
    halfOpenMaxAttempts: 1,   // one probe in half-open
  },
});

// Catch circuit breaker errors to handle degraded mode:
try {
  await client.agents.search('laptop');
} catch (error) {
  if (error instanceof CircuitBreakerError) {
    console.log(`Circuit open — state: ${error.circuitState}`);
  }
}
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

## Get your API key

Sign up free at <https://buywhere.ai/api-keys> — 60 seconds, no credit card.

## Development

```bash
npm run build
npm test
```
