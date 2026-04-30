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
import categoriesRouter from '../routes/categories';

const VALID_API_KEY_RECORD = {
  id: 'key-1',
  key: 'bw_test123',
  agentName: 'TestAgent',
  tier: 'free',
  rpmLimit: 60,
  dailyLimit: 1000,
  signupChannel: null,
  attributionSource: null,
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).apiKeyRecord = VALID_API_KEY_RECORD;
    (req as any).agentInfo = { framework: 'custom', version: '', sdkLanguage: 'unknown' };
    next();
  });
  app.use('/v1/categories', categoriesRouter);
  return app;
}

describe('GET /v1/categories', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
  });

  it('returns top-level categories list', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        { name: 'Electronics', product_count: '150' },
        { name: 'Fashion', product_count: '80' },
      ],
    });

    const app = buildApp();
    const res = await request(app).get('/v1/categories');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toMatchObject({
      name: 'Electronics',
      slug: 'electronics',
      product_count: 150,
    });
    expect(res.body.meta.total).toBe(2);
  });

  it('returns cached response when Redis hit', async () => {
    const cachedBody = {
      data: [{ slug: 'electronics', name: 'Electronics', product_count: 100 }],
      meta: { total: 1, response_time_ms: 3 },
    };
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(cachedBody));

    const app = buildApp();
    const res = await request(app).get('/v1/categories');

    expect(res.status).toBe(200);
    expect(res.body.data[0].slug).toBe('electronics');
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  it('defaults to SGD currency', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const app = buildApp();
    await request(app).get('/v1/categories');

    const firstCallParams = mockDbQuery.mock.calls[0][1] as string[];
    expect(firstCallParams[0]).toBe('SGD');
  });

  it('accepts currency query param', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const app = buildApp();
    await request(app).get('/v1/categories?currency=USD');

    const firstCallParams = mockDbQuery.mock.calls[0][1] as string[];
    expect(firstCallParams[0]).toBe('USD');
  });

  it('returns empty data array when no categories', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const app = buildApp();
    const res = await request(app).get('/v1/categories');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('generates correct slug from category name', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ name: 'Home & Garden', product_count: '20' }],
    });

    const app = buildApp();
    const res = await request(app).get('/v1/categories');

    expect(res.body.data[0].slug).toBe('home-garden');
  });
});

describe('GET /v1/categories/:slug', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
  });

  it('returns 404 when category slug not found', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // slug lookup returns empty

    const app = buildApp();
    const res = await request(app).get('/v1/categories/nonexistent-slug');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Category not found');
  });

  it('returns category detail with products and subcategories', async () => {
    // slug lookup
    mockDbQuery.mockResolvedValueOnce({ rows: [{ name: 'Electronics' }] });
    // count + products + subcategories (Promise.all — 3 calls)
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ count: '5' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'p1',
            source_id: 'lazada-1',
            domain: 'lazada',
            url: 'https://lazada.sg/p1',
            title: 'Phone',
            price: '599.00',
            currency: 'SGD',
            image_url: null,
            updated_at: new Date(),
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ sub_name: 'Phones', product_count: '3' }],
      });

    const app = buildApp();
    const res = await request(app).get('/v1/categories/electronics');

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Electronics');
    expect(res.body.data.product_count).toBe(5);
    expect(res.body.data.products).toHaveLength(1);
    expect(res.body.data.products[0].title).toBe('Phone');
    expect(res.body.data.subcategories).toHaveLength(1);
    expect(res.body.data.subcategories[0].slug).toBe('phones');
  });

  it('filters out null subcategory names', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ name: 'Fashion' }] });
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          { sub_name: null, product_count: '1' },
          { sub_name: 'Shoes', product_count: '2' },
        ],
      });

    const app = buildApp();
    const res = await request(app).get('/v1/categories/fashion');

    expect(res.status).toBe(200);
    expect(res.body.data.subcategories).toHaveLength(1);
    expect(res.body.data.subcategories[0].name).toBe('Shoes');
  });

  it('includes meta with limit and offset', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ name: 'Electronics' }] });
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ count: '10' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const app = buildApp();
    const res = await request(app).get('/v1/categories/electronics?limit=5&offset=10');

    expect(res.status).toBe(200);
    expect(res.body.meta.limit).toBe(5);
    expect(res.body.meta.offset).toBe(10);
  });
});
