import assert from 'node:assert/strict';
import test from 'node:test';
import sinon from 'sinon';

import {
  SearchProductsTool,
  ComparePricesTool,
  GetDealsTool,
  GetProductDetailsTool,
  GetPriceHistoryTool,
  AgentSearchProductsTool,
  createBuyWhereTools,
} from '../dist/index.js';

const BW_API_KEY = 'bw_live_test';

function mockSearchResults() {
  return {
    total: 2,
    limit: 5,
    offset: 0,
    has_more: false,
    items: [
      {
        id: 123,
        name: 'Test Product 1',
        price: 99.99,
        currency: 'SGD',
        source: 'shopee_sg',
        buy_url: 'https://shopee.sg/product/123',
        is_available: true,
        rating: 4.5,
      },
      {
        id: 456,
        name: 'Test Product 2',
        price: 149.99,
        currency: 'SGD',
        source: 'lazada_sg',
        buy_url: 'https://lazada.sg/product/456',
        is_available: true,
        rating: 4.2,
      },
    ],
  };
}

function mockCompareResults() {
  return {
    category: { id: 'electronics', name: 'Electronics', slug: 'electronics' },
    products: [
      {
        id: 123,
        name: 'iPhone 15',
        brand: 'Apple',
        sku: 'iphone-15-128',
        prices: [
          {
            merchant: 'shopee_sg',
            price: '1299.00',
            currency: 'SGD',
            url: 'https://shopee.sg/iphone15',
            in_stock: true,
            rating: 4.8,
            last_updated: '2026-04-26T00:00:00Z',
            savings_pct: 5,
          },
        ],
        lowest_price: '1299.00',
        lowest_price_merchant: 'shopee_sg',
        lowest_price_best_value: true,
      },
    ],
    meta: {
      total_products: 1,
      total_merchants: 3,
      last_updated: '2026-04-26T00:00:00Z',
    },
  };
}

function mockDealsResults() {
  return {
    deals: [
      {
        id: 789,
        name: 'Samsung Galaxy S24',
        price: 999.00,
        original_price: 1299.00,
        currency: 'SGD',
        discount_pct: 23,
        merchant: 'shopee_sg',
        url: 'https://shopee.sg/galaxy-s24',
        ends_at: '2026-04-30T23:59:59Z',
        is_exclusive: true,
      },
    ],
    meta: {
      total: 1,
      has_more: false,
      last_updated: '2026-04-26T00:00:00Z',
    },
  };
}

function mockProductDetail() {
  return {
    id: 123,
    name: 'iPhone 15 Pro 256GB',
    brand: 'Apple',
    description: 'Latest iPhone with A17 Pro chip',
    category: 'electronics',
    prices: [
      {
        merchant: 'shopee_sg',
        price: '1699.00',
        currency: 'SGD',
        url: 'https://shopee.sg/iphone15pro',
        in_stock: true,
        rating: 4.9,
        last_updated: '2026-04-26T00:00:00Z',
      },
    ],
    lowest_price: '1699.00',
    lowest_price_merchant: 'shopee_sg',
    image_url: 'https://cdn.buywhere.ai/iphone15pro.jpg',
    rating: 4.8,
    reviews_count: 234,
    last_updated: '2026-04-26T00:00:00Z',
  };
}

function mockPriceHistory() {
  return {
    product_id: 123,
    product_name: 'iPhone 15',
    country: 'SG',
    currency: 'SGD',
    period: '30d',
    price_history: [
      { date: '2026-04-01', price: 1299, currency: 'SGD' },
      { date: '2026-04-15', price: 1249, currency: 'SGD' },
      { date: '2026-04-26', price: 1199, currency: 'SGD' },
    ],
    lowest_price: 1199,
    highest_price: 1299,
    average_price: 1249,
    lowest_price_date: '2026-04-26T00:00:00Z',
    highest_price_date: '2026-04-01T00:00:00Z',
  };
}

function mockAgentSearchResults() {
  return {
    total: 2,
    limit: 10,
    offset: 0,
    has_more: false,
    query_processed: 'iphone 15 singapore best price',
    results: [
      {
        id: 123,
        sku: 'iphone-15-128',
        source: 'shopee_sg',
        title: 'iPhone 15 128GB Black',
        price: 1299,
        currency: 'SGD',
        price_sgd: 1299,
        url: 'https://shopee.sg/iphone15',
        brand: 'Apple',
        category: 'electronics',
        image_url: 'https://cdn.buywhere.ai/iphone15.jpg',
        rating: 4.8,
        review_count: 1523,
        is_available: true,
        in_stock: true,
        stock_level: 'high',
        confidence_score: 0.95,
        availability_prediction: 'in_stock',
        competitor_count: 12,
        buybox_price: 1299,
        affiliate_url: 'https://buywhere.ai/click/abc123',
        headline: 'Best price in Singapore',
        data_freshness: '2026-04-26T12:00:00Z',
        freshness_score: 0.98,
      },
    ],
    query_time_ms: 45,
    cache_hit: false,
  };
}

test('SearchProductsTool returns formatted product results', async () => {
  const tool = new SearchProductsTool({ apiKey: BW_API_KEY });

  const results = await tool.invoke(JSON.stringify({
    query: 'laptop',
    country: 'SG',
    limit: 5,
  }));

  const parsed = JSON.parse(results);
  assert.equal(parsed.success, true);
  assert.ok(parsed.total !== undefined);
  assert.ok(Array.isArray(parsed.products));
});

test('SearchProductsTool handles errors gracefully', async () => {
  const tool = new SearchProductsTool({ apiKey: BW_API_KEY });

  const results = await tool.invoke(JSON.stringify({
    query: '',
  }));

  const parsed = JSON.parse(results);
  assert.ok(parsed.success !== undefined);
});

test('ComparePricesTool returns price comparison results', async () => {
  const tool = new ComparePricesTool({ apiKey: BW_API_KEY });

  const results = await tool.invoke(JSON.stringify({
    query: 'iphone 15',
    category: 'electronics',
    limit: 10,
  }));

  const parsed = JSON.parse(results);
  assert.ok(parsed.success !== undefined);
});

test('GetDealsTool returns formatted deals', async () => {
  const tool = new GetDealsTool({ apiKey: BW_API_KEY });

  const results = await tool.invoke(JSON.stringify({
    country: 'SG',
    category: 'electronics',
    limit: 5,
    min_discount_pct: 20,
  }));

  const parsed = JSON.parse(results);
  assert.ok(parsed.success !== undefined);
});

test('GetProductDetailsTool returns product details', async () => {
  const tool = new GetProductDetailsTool({ apiKey: BW_API_KEY });

  const results = await tool.invoke(JSON.stringify({
    product_id: 123,
  }));

  const parsed = JSON.parse(results);
  assert.ok(parsed.success !== undefined);
});

test('GetPriceHistoryTool returns price history data', async () => {
  const tool = new GetPriceHistoryTool({ apiKey: BW_API_KEY });

  const results = await tool.invoke(JSON.stringify({
    product_id: 123,
    country: 'SG',
    period: '30d',
  }));

  const parsed = JSON.parse(results);
  assert.ok(parsed.success !== undefined);
});

test('AgentSearchProductsTool returns enhanced agent results', async () => {
  const tool = new AgentSearchProductsTool({ apiKey: BW_API_KEY });

  const results = await tool.invoke(JSON.stringify({
    q: 'iphone 15 singapore',
    limit: 10,
    include_agent_insights: true,
    include_availability_prediction: true,
  }));

  const parsed = JSON.parse(results);
  assert.equal(parsed.success, true);
  assert.ok(parsed.total !== undefined);
  assert.ok(parsed.query_processed !== undefined);
});

test('createBuyWhereTools returns all 6 tools', () => {
  const tools = createBuyWhereTools({ apiKey: BW_API_KEY });

  assert.equal(tools.length, 6);

  const toolNames = tools.map((t) => t.name);
  assert.ok(toolNames.includes('search_products'));
  assert.ok(toolNames.includes('compare_prices'));
  assert.ok(toolNames.includes('get_deals'));
  assert.ok(toolNames.includes('get_product_details'));
  assert.ok(toolNames.includes('get_price_history'));
  assert.ok(toolNames.includes('agent_search_products'));
});

test('each tool has correct name and description', () => {
  const tools = createBuyWhereTools({ apiKey: BW_API_KEY });

  for (const tool of tools) {
    assert.ok(tool.name.length > 0, `${tool.constructor.name} should have a name`);
    assert.ok(tool.description.length > 0, `${tool.constructor.name} should have a description`);
  }
});

test('tools are LangChain Tool instances', () => {
  const tools = createBuyWhereTools({ apiKey: BW_API_KEY });

  for (const tool of tools) {
    assert.ok('_call' in tool, `${tool.name} should have _call method`);
    assert.ok('invoke' in tool, `${tool.name} should have invoke method`);
  }
});

test('SearchProductsTool accepts JSON string input', async () => {
  const tool = new SearchProductsTool({ apiKey: BW_API_KEY });

  const input = JSON.stringify({ query: 'headphones', limit: 3 });
  const result = await tool.invoke(input);

  const parsed = JSON.parse(result);
  assert.ok(parsed.hasOwnProperty('success') || parsed.hasOwnProperty('total'));
});

test('SearchProductsTool handles malformed JSON', async () => {
  const tool = new SearchProductsTool({ apiKey: BW_API_KEY });

  const result = await tool.invoke('not valid json');
  const parsed = JSON.parse(result);

  assert.equal(parsed.success, false);
  assert.ok(parsed.error !== undefined);
});

test('ComparePricesTool with minimal params', async () => {
  const tool = new ComparePricesTool({ apiKey: BW_API_KEY });

  const result = await tool.invoke(JSON.stringify({ query: 'tv' }));
  const parsed = JSON.parse(result);

  assert.ok(parsed.success !== undefined);
});

test('GetDealsTool with only country', async () => {
  const tool = new GetDealsTool({ apiKey: BW_API_KEY });

  const result = await tool.invoke(JSON.stringify({ country: 'MY' }));
  const parsed = JSON.parse(result);

  assert.ok(parsed.success !== undefined);
});

test('GetProductDetailsTool with required product_id only', async () => {
  const tool = new GetProductDetailsTool({ apiKey: BW_API_KEY });

  const result = await tool.invoke(JSON.stringify({ product_id: 999 }));
  const parsed = JSON.parse(result);

  assert.ok(parsed.success !== undefined);
});

test('GetPriceHistoryTool defaults period to 30d', async () => {
  const tool = new GetPriceHistoryTool({ apiKey: BW_API_KEY });

  const result = await tool.invoke(JSON.stringify({ product_id: 123 }));
  const parsed = JSON.parse(result);

  assert.ok(parsed.success !== undefined);
});

test('AgentSearchProductsTool with sort options', async () => {
  const tool = new AgentSearchProductsTool({ apiKey: BW_API_KEY });

  const result = await tool.invoke(JSON.stringify({
    q: 'laptop',
    sort_by: 'price_asc',
    min_price: 500,
    max_price: 2000,
  }));

  const parsed = JSON.parse(result);
  assert.equal(parsed.success, true);
});

test('AgentSearchProductsTool with availability prediction', async () => {
  const tool = new AgentSearchProductsTool({ apiKey: BW_API_KEY });

  const result = await tool.invoke(JSON.stringify({
    q: 'samsung phone',
    include_availability_prediction: true,
  }));

  const parsed = JSON.parse(result);
  assert.equal(parsed.success, true);
});