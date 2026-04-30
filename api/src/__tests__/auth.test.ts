const mockDbQuery = jest.fn();

jest.mock('../config', () => ({
  db: { query: mockDbQuery },
  redis: {
    get: jest.fn(),
    set: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
  },
  FREE_TIER: { rpm: 60, daily: 1000 },
}));

jest.mock('../analytics/posthog', () => ({
  trackRegistration: jest.fn(),
  trackApiQuery: jest.fn(),
}));

import request from 'supertest';
import express from 'express';
import authRouter from '../routes/auth';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/v1/auth', authRouter);
  return app;
}

describe('POST /v1/auth/register', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when agent_name is missing', async () => {
    const app = buildApp();
    const res = await request(app).post('/v1/auth/register').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/agent_name is required/);
  });

  it('returns 400 when agent_name is not a string', async () => {
    const app = buildApp();
    const res = await request(app).post('/v1/auth/register').send({ agent_name: 42 });
    expect(res.status).toBe(400);
  });

  it('returns 201 with api_key and tier on success', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // INSERT succeeds

    const app = buildApp();
    const res = await request(app).post('/v1/auth/register').send({
      agent_name: 'TestBot',
      contact: 'test@example.com',
      use_case: 'price tracking',
    });

    expect(res.status).toBe(201);
    expect(res.body.api_key).toMatch(/^bw_/);
    expect(res.body.tier).toBe('free');
    expect(res.body.rate_limit).toMatchObject({ rpm: 60, daily: 1000 });
    expect(res.body.docs).toBe('https://api.buywhere.ai/docs');
  });

  it('inserts a hashed key (never stores raw key)', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const app = buildApp();
    const res = await request(app).post('/v1/auth/register').send({ agent_name: 'HashBot' });

    expect(res.status).toBe(201);
    const rawKey = res.body.api_key;
    const insertCall = mockDbQuery.mock.calls[0];
    const insertParams = insertCall[1] as string[];
    // First param is the key_hash — must NOT be the raw key
    expect(insertParams[0]).not.toBe(rawKey);
    expect(insertParams[0]).toHaveLength(64); // SHA-256 hex
  });

  it('trims and truncates long agent_name to 200 chars', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const longName = '  ' + 'a'.repeat(300) + '  ';
    const app = buildApp();
    const res = await request(app).post('/v1/auth/register').send({ agent_name: longName });

    expect(res.status).toBe(201);
    const insertParams = mockDbQuery.mock.calls[0][1] as string[];
    expect(insertParams[1].length).toBeLessThanOrEqual(200);
    expect(insertParams[1]).not.toMatch(/^\s/); // trimmed
  });

  it('resolves github signup channel from utm_source', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const app = buildApp();
    await request(app)
      .post('/v1/auth/register?utm_source=github')
      .send({ agent_name: 'GithubBot' });

    const insertParams = mockDbQuery.mock.calls[0][1] as string[];
    expect(insertParams[4]).toBe('github'); // signup_channel
  });

  it('resolves producthunt signup channel', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const app = buildApp();
    await request(app)
      .post('/v1/auth/register')
      .send({ agent_name: 'PHBot', utm_source: 'producthunt' });

    const insertParams = mockDbQuery.mock.calls[0][1] as string[];
    expect(insertParams[4]).toBe('product_hunt');
  });

  it('resolves google signup channel from Referer header', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const app = buildApp();
    await request(app)
      .post('/v1/auth/register')
      .set('Referer', 'https://www.google.com/search?q=buywhere')
      .send({ agent_name: 'GoogleBot' });

    const insertParams = mockDbQuery.mock.calls[0][1] as string[];
    expect(insertParams[4]).toBe('google_search');
  });

  it('defaults signup_channel to direct when no referer or utm', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const app = buildApp();
    await request(app).post('/v1/auth/register').send({ agent_name: 'DirectBot' });

    const insertParams = mockDbQuery.mock.calls[0][1] as string[];
    expect(insertParams[4]).toBe('direct');
  });
});
