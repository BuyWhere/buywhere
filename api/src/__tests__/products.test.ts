const mockDbQuery = jest.fn();
const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();
const mockRedisIncr = jest.fn().mockResolvedValue(1);
const mockRedisExpire = jest.fn().mockResolvedValue(1);

jest.mock('../config', () => ({
  db: { query: mockDbQuery },
  redis: {
    get: mockRedisGet,
    set: mockRedisSet,
    incr: mockRedisIncr,
    expire: mockRedisExpire,
  },
  FREE_TIER: { rpm: 60, daily: 1000 },
}));

jest.mock('../analytics/posthog', () => ({
  trackRegistration: jest.fn(),
  trackApiQuery: jest.fn(),
}));

// Bypass auth middleware so tests focus on route logic
jest.mock('../middleware/apiKey', () => ({
  requireApiKey: (_req: any, _res: any, next: any) => next(),
  checkRateLimit: (_req: any, _res: any, next: any) => next(),
  hashKey: (k: string) => require('crypto').createHash('sha256').update(k).digest('hex'),
}));

jest.mock('../middleware/queryLog', () => ({
  queryLogMiddleware: () => (_req: any, _res: any, next: any) => next(),
}));

import request from 'supertest';
import express from 'express';
import productsRouter from '../routes/products';

const VALID_API_KEY_RECORD = {
  id: 'key-1',
  key: 'bw_test123',
  agentName: 'TestAgent',
  tier: 'free',
  rpmLimit: 60,
  dailyLimit: 1000,
  signupChannel: 'github',
  attributionSource: null,
};

// Inject a pre-validated apiKeyRecord to bypass requireApiKey/checkRateLimit
function buildApp() {
  const app = express();
  app.use(express.json());
  // Inject auth context so we can test the route logic independently of middleware
  app.use((req, _res, next) => {
    (req as any).apiKeyRecord = VALID_API_KEY_RECORD;
    (req as any).agentInfo = { framework: 'custom', version: '', sdkLanguage: 'unknown' };
    next();
  });
  app.use('/v1/products', productsRouter);
  return app;
}

function makeProductRow(overrides = {}) {
  return {
    id: 'prod-1',
    source_id: 'lazada-123',
    domain: 'lazada.sg',
    url: 'https://lazada.sg/product/123',
    title: 'iPhone 15 Pro',
    price: '1599.00',
    currency: 'SGD',
    image_url: 'https://img.lazada.sg/iphone.jpg',
    metadata: { brand: 'Apple', category: 'Electronics' },
    updated_at: new Date('2026-01-01T00:00:00Z'),
    region: 'SEA',
    country_code: 'SG',
    ...overrides,
  };
}

describe('GET /v1/products/search', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: Redis cache miss
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
  });

  it('returns standard envelope with data and meta', async () => {
    const row = makeProductRow();
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] }) // count query
      .mockResolvedValueOnce({ rows: [row] });             // data query

    const app = buildApp();
    const res = await request(app).get('/v1/products/search?q=iphone&currency=SGD');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta).toMatchObject({ total: 1, limit: 20, offset: 0 });
    expect(res.body.data[0].title).toBe('iPhone 15 Pro');
  });

  it('returns compact envelope when ?compact=true', async () => {
    const row = makeProductRow();
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [row] });

    const app = buildApp();
    const res = await request(app).get('/v1/products/search?q=iphone&compact=true');

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.total).toBe(1);
    expect(res.body.page).toMatchObject({ limit: 20, offset: 0 });
    // Compact result has price object, not flat price
    expect(res.body.results[0].price).toMatchObject({ amount: 1599, currency: 'SGD' });
  });

  it('returns cached response when Redis hit', async () => {
    const cachedBody = {
      data: [{ id: 'cached-prod', title: 'Cached Product' }],
      meta: { total: 1, limit: 20, offset: 0, response_time_ms: 5, cached: false },
    };
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(cachedBody));

    const app = buildApp();
    const res = await request(app).get('/v1/products/search?q=iphone');

    expect(res.status).toBe(200);
    expect(res.body.meta.cached).toBe(true);
    // DB should NOT be queried when cache is hot
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  it('defaults currency to SGD when not specified', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] });

    const app = buildApp();
    await request(app).get('/v1/products/search');

    // First DB call should have SGD as first param
    expect(mockDbQuery).toHaveBeenCalled();
    const firstCallParams = mockDbQuery.mock.calls[0][1] as string[];
    expect(firstCallParams[0]).toBe('SGD');
  });

  it('infers currency from country_code when currency not given', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] });

    const app = buildApp();
    await request(app).get('/v1/products/search?country_code=US');

    const firstCallParams = mockDbQuery.mock.calls[0][1] as string[];
    expect(firstCallParams[0]).toBe('USD');
  });

  it('caps limit at 100', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] });

    const app = buildApp();
    const res = await request(app).get('/v1/products/search?limit=9999');

    expect(res.status).toBe(200);
    // Confirm DB was queried with capped limit of 100
    const dataCallParams = mockDbQuery.mock.calls[1][1] as unknown[];
    const limitParam = dataCallParams[dataCallParams.length - 2];
    expect(limitParam).toBe(100);
  });

  it('returns empty results gracefully', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] });

    const app = buildApp();
    const res = await request(app).get('/v1/products/search?q=nonexistent');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.meta.total).toBe(0);
  });

  it('supports domain filter', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [makeProductRow()] });

    const app = buildApp();
    const res = await request(app).get('/v1/products/search?domain=lazada.sg');

    expect(res.status).toBe(200);
    // domain param should appear in the DB query
    const allParams = mockDbQuery.mock.calls.flatMap(c => c[1] as string[]);
    expect(allParams).toContain('lazada.sg');
  });

  it('falls through to DB when Redis throws', async () => {
    mockRedisGet.mockRejectedValueOnce(new Error('Redis timeout'));
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [makeProductRow()] });

    const app = buildApp();
    const res = await request(app).get('/v1/products/search?q=iphone');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('includes normalized_price_usd in compact mode for known currencies', async () => {
    const row = makeProductRow({ price: '100.00', currency: 'SGD' });
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [row] });

    const app = buildApp();
    const res = await request(app).get('/v1/products/search?compact=true');

    expect(res.status).toBe(200);
    const product = res.body.results[0];
    // SGD → USD rate ~0.74
    expect(product.normalized_price_usd).toBeCloseTo(74, 0);
  });
});

describe('GET /v1/products/deals', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
  });

  it('returns deals list with discount info', async () => {
    const dealRow = {
      ...makeProductRow({ price: '800.00' }),
      original_price: '1000',
      discount_pct: '20.0',
    };
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [dealRow] });

    const app = buildApp();
    const res = await request(app).get('/v1/products/deals');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].discount_pct).toBe(20.0);
    expect(res.body.meta).toMatchObject({ total: 1 });
  });

  it('returns cached deals response', async () => {
    const cached = {
      data: [{ id: 'deal-1', discount_pct: 30 }],
      meta: { total: 1, cached: false, response_time_ms: 10 },
    };
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(cached));

    const app = buildApp();
    const res = await request(app).get('/v1/products/deals');

    expect(res.status).toBe(200);
    expect(res.body.meta.cached).toBe(true);
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  it('accepts min_discount param', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] });

    const app = buildApp();
    const res = await request(app).get('/v1/products/deals?min_discount=25');

    expect(res.status).toBe(200);
    const allParams = mockDbQuery.mock.calls.flatMap(c => c[1] as unknown[]);
    expect(allParams).toContain(25);
  });
});

describe('GET /v1/products/compare', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
  });

  it('returns 400 when fewer than 2 IDs provided', async () => {
    const app = buildApp();
    const res = await request(app).get('/v1/products/compare?ids=single-id');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 2/);
  });

  it('returns 400 when no IDs provided', async () => {
    const app = buildApp();
    const res = await request(app).get('/v1/products/compare');

    expect(res.status).toBe(400);
  });

  it('returns comparison data for valid IDs', async () => {
    const rows = [
      makeProductRow({ id: 'prod-1', title: 'iPhone 15 Pro', price: '1599.00' }),
      makeProductRow({ id: 'prod-2', title: 'Samsung S24', price: '1299.00' }),
    ];
    mockDbQuery.mockResolvedValueOnce({ rows });

    const app = buildApp();
    const res = await request(app).get('/v1/products/compare?ids=prod-1,prod-2');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });
});

describe('GET /v1/products/:id/price-history', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
  });

  it('returns 404 when product not found', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // product lookup

    const app = buildApp();
    const res = await request(app).get('/v1/products/nonexistent/price-history');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns price history for a valid product', async () => {
    const productRow = { id: 'prod-1', title: 'iPhone 15', price: '1599.00', currency: 'SGD', domain: 'lazada.sg' };
    const historyRows = [
      { day: '2026-01-01', currency: 'SGD', min_price: 1699, max_price: 1699, avg_price: 1699, data_points: '1' },
      { day: '2026-01-15', currency: 'SGD', min_price: 1599, max_price: 1599, avg_price: 1599, data_points: '1' },
    ];
    mockDbQuery
      .mockResolvedValueOnce({ rows: [productRow] })   // product lookup
      .mockResolvedValueOnce({ rows: historyRows });     // history lookup

    const app = buildApp();
    const res = await request(app).get('/v1/products/prod-1/price-history');

    expect(res.status).toBe(200);
    expect(res.body.data.daily).toHaveLength(2);
    expect(res.body.data.product_id).toBe('prod-1');
  });
});

describe('GET /v1/products/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
  });

  it('returns 404 for non-existent product', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const app = buildApp();
    const res = await request(app).get('/v1/products/no-such-id');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Product not found');
  });

  it('returns product detail for valid id', async () => {
    const row = {
      ...makeProductRow(),
      id: 'prod-abc',
      brand: 'Apple',
      category_path: ['Electronics', 'Phones'],
      rating: '4.5',  // SQL alias: avg_rating AS rating
      review_count: 120,
    };
    mockDbQuery.mockResolvedValueOnce({ rows: [row] });

    const app = buildApp();
    const res = await request(app).get('/v1/products/prod-abc');

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('prod-abc');
    expect(res.body.data.brand).toBe('Apple');
    expect(res.body.data.rating).toBe(4.5);
    expect(res.body.data.review_count).toBe(120);
  });
});

describe('GET /v1/products/:id/prices', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
  });

  it('returns 404 when product not found', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [] }) // product lookup
      .mockResolvedValueOnce({ rows: [] }); // history lookup

    const app = buildApp();
    const res = await request(app).get('/v1/products/nonexistent/prices');

    expect(res.status).toBe(404);
  });

  it('returns price snapshots for a valid product', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'prod-1', title: 'iPhone', price: '1599.00', currency: 'SGD' }] })
      .mockResolvedValueOnce({
        rows: [
          { price: '1699.00', currency: 'SGD', scraped_at: new Date('2026-01-01') },
        ],
      });

    const app = buildApp();
    const res = await request(app).get('/v1/products/prod-1/prices');

    expect(res.status).toBe(200);
    expect(res.body.data.history).toHaveLength(1);
    expect(res.body.data.stats).not.toBeNull();
  });

  it('returns null stats when no history', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'prod-1', title: 'iPhone', price: '1599.00', currency: 'SGD' }] })
      .mockResolvedValueOnce({ rows: [] });

    const app = buildApp();
    const res = await request(app).get('/v1/products/prod-1/prices');

    expect(res.status).toBe(200);
    expect(res.body.data.stats).toBeNull();
  });
});

describe('GET /v1/products/:id/similar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 404 when product not found', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const app = buildApp();
    const res = await request(app).get('/v1/products/no-such-id/similar');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns similar products via brand+category match', async () => {
    const srcRow = {
      id: 'prod-1', title: 'iPhone 15 Pro', brand: 'Apple',
      category_path: ['Electronics', 'Phones'], currency: 'SGD', search_vector: null,
    };
    const similarRow = makeProductRow({ id: 'prod-2', title: 'iPhone 14', source_id: 'lazada-2' });

    mockDbQuery
      .mockResolvedValueOnce({ rows: [srcRow] })         // source product
      .mockResolvedValueOnce({ rows: [similarRow] })     // brand+category match
      .mockResolvedValueOnce({ rows: [] });               // FTS pad (limit=8, 1 result → needs 7 more)

    const app = buildApp();
    const res = await request(app).get('/v1/products/prod-1/similar');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.source_id).toBe('prod-1');
  });

  it('falls back to FTS when brand+category returns fewer than limit', async () => {
    const srcRow = {
      id: 'prod-1', title: 'iPhone 15 Pro', brand: 'Apple',
      category_path: ['Electronics'], currency: 'SGD', search_vector: null,
    };
    const ftsSimilar = makeProductRow({ id: 'prod-3', title: 'iPhone SE' });

    mockDbQuery
      .mockResolvedValueOnce({ rows: [srcRow] })    // source product
      .mockResolvedValueOnce({ rows: [] })           // brand+category: 0 results
      .mockResolvedValueOnce({ rows: [ftsSimilar] });// FTS fallback

    const app = buildApp();
    const res = await request(app).get('/v1/products/prod-1/similar');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('handles product with no brand (skips phase 1)', async () => {
    const srcRow = {
      id: 'prod-1', title: 'Generic Widget', brand: null,
      category_path: null, currency: 'SGD', search_vector: null,
    };
    const ftsSimilar = makeProductRow({ id: 'prod-2' });

    mockDbQuery
      .mockResolvedValueOnce({ rows: [srcRow] })
      .mockResolvedValueOnce({ rows: [ftsSimilar] }); // goes straight to FTS

    const app = buildApp();
    const res = await request(app).get('/v1/products/prod-1/similar');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('POST /v1/products/ingest', () => {
  const validProduct = {
    platform: 'lazada',
    name: 'Test Product',
    price: '99.00',
    product_url: 'https://lazada.sg/test',
    currency: 'SGD',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when body is not an array', async () => {
    const app = buildApp();
    const res = await request(app).post('/v1/products/ingest').send({ product: 'oops' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-empty array/);
  });

  it('returns 400 when body is empty array', async () => {
    const app = buildApp();
    const res = await request(app).post('/v1/products/ingest').send([]);

    expect(res.status).toBe(400);
  });

  it('returns 400 when more than 500 products', async () => {
    const items = new Array(501).fill(validProduct);
    const app = buildApp();
    const res = await request(app).post('/v1/products/ingest').send(items);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/500/);
  });

  it('returns 400 for invalid platform', async () => {
    const app = buildApp();
    const res = await request(app).post('/v1/products/ingest').send([{
      ...validProduct,
      platform: 'unknown_platform',
    }]);

    // All rows invalid → 400
    expect(res.status).toBe(400);
    expect(res.body.validation_errors).toBeDefined();
  });

  it('accepts valid product and returns 207', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ is_insert: true }] });

    const app = buildApp();
    const res = await request(app).post('/v1/products/ingest').send([validProduct]);

    expect(res.status).toBe(207);
    expect(res.body.accepted).toBe(1);
    expect(res.body.inserted).toBe(1);
  });

  it('skips invalid items and reports them in validation_errors', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ is_insert: true }] });

    const app = buildApp();
    const res = await request(app).post('/v1/products/ingest').send([
      validProduct,
      { platform: 'lazada', name: 'No price' }, // missing price
    ]);

    expect(res.status).toBe(207);
    expect(res.body.accepted).toBe(1);
    expect(res.body.skipped).toBe(1);
    expect(res.body.validation_errors).toHaveLength(1);
  });
});
