import { createHash } from 'crypto';

// Mock config before any imports that use it
const mockDbQuery = jest.fn();
const mockRedisIncr = jest.fn();
const mockRedisExpire = jest.fn();

jest.mock('../config', () => ({
  db: { query: mockDbQuery },
  redis: {
    incr: mockRedisIncr,
    expire: mockRedisExpire,
    get: jest.fn(),
    set: jest.fn(),
  },
  FREE_TIER: { rpm: 60, daily: 1000 },
}));

// Mock analytics to prevent PostHog init
jest.mock('../analytics/posthog', () => ({
  trackRegistration: jest.fn(),
  trackApiQuery: jest.fn(),
}));

import { hashKey, requireApiKey, checkRateLimit } from '../middleware/apiKey';
import { Request, Response, NextFunction } from 'express';

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    query: {},
    ...overrides,
  } as unknown as Request;
}

function makeRes(): { res: Response; status: jest.Mock; json: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { res, status, json };
}

describe('hashKey', () => {
  it('produces a SHA-256 hex string', () => {
    const hash = hashKey('bw_testkey123');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic', () => {
    expect(hashKey('same_key')).toBe(hashKey('same_key'));
  });

  it('produces different hashes for different inputs', () => {
    expect(hashKey('key_a')).not.toBe(hashKey('key_b'));
  });

  it('matches expected SHA-256 output', () => {
    const expected = createHash('sha256').update('my_key').digest('hex');
    expect(hashKey('my_key')).toBe(expected);
  });
});

describe('requireApiKey middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when no Authorization header or api_key query param', async () => {
    const req = makeReq();
    const { res, status, json } = makeRes();
    const next = jest.fn();

    await requireApiKey(req, res, next as NextFunction);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('API key required') }));
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for invalid API key (not in DB)', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const req = makeReq({ headers: { authorization: 'Bearer bw_invalid' } });
    const { res, status, json } = makeRes();
    const next = jest.fn();

    await requireApiKey(req, res, next as NextFunction);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Invalid API key' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('attaches apiKeyRecord and calls next for valid Bearer key', async () => {
    const fakeRow = {
      id: 'key-uuid-1',
      key_hash: hashKey('bw_valid'),
      name: 'TestAgent',
      tier: 'free',
      signup_channel: 'github',
      attribution_source: null,
    };
    mockDbQuery
      .mockResolvedValueOnce({ rows: [fakeRow] })   // SELECT
      .mockResolvedValueOnce({ rows: [] });           // UPDATE last_used_at

    const req = makeReq({ headers: { authorization: 'Bearer bw_valid' } });
    const { res } = makeRes();
    const next = jest.fn();

    await requireApiKey(req, res, next as NextFunction);

    expect(next).toHaveBeenCalled();
    expect((req as any).apiKeyRecord).toMatchObject({
      id: 'key-uuid-1',
      agentName: 'TestAgent',
      tier: 'free',
      rpmLimit: 60,
      dailyLimit: 1000,
    });
  });

  it('accepts ApiKey prefix', async () => {
    const fakeRow = {
      id: 'key-uuid-2',
      key_hash: hashKey('bw_apikey'),
      name: 'Bot',
      tier: 'pro',
      signup_channel: null,
      attribution_source: null,
    };
    mockDbQuery
      .mockResolvedValueOnce({ rows: [fakeRow] })
      .mockResolvedValueOnce({ rows: [] });

    const req = makeReq({ headers: { authorization: 'ApiKey bw_apikey' } });
    const { res } = makeRes();
    const next = jest.fn();

    await requireApiKey(req, res, next as NextFunction);

    expect(next).toHaveBeenCalled();
    expect((req as any).apiKeyRecord.rpmLimit).toBe(300); // pro tier
  });

  it('accepts api_key query param', async () => {
    const fakeRow = {
      id: 'key-uuid-3',
      key_hash: hashKey('bw_queryparam'),
      name: 'QueryBot',
      tier: 'free',
      signup_channel: null,
      attribution_source: null,
    };
    mockDbQuery
      .mockResolvedValueOnce({ rows: [fakeRow] })
      .mockResolvedValueOnce({ rows: [] });

    const req = makeReq({ query: { api_key: 'bw_queryparam' } });
    const { res } = makeRes();
    const next = jest.fn();

    await requireApiKey(req, res, next as NextFunction);

    expect(next).toHaveBeenCalled();
  });
});

describe('checkRateLimit middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('skips check if no apiKeyRecord attached', async () => {
    const req = makeReq();
    const { res } = makeRes();
    const next = jest.fn();

    await checkRateLimit(req, res, next as NextFunction);

    expect(next).toHaveBeenCalled();
    expect(mockRedisIncr).not.toHaveBeenCalled();
  });

  it('allows through when under rpm and daily limits', async () => {
    mockRedisIncr
      .mockResolvedValueOnce(1)   // rpm count
      .mockResolvedValueOnce(1);  // daily count
    mockRedisExpire.mockResolvedValue(1);

    const req = makeReq();
    (req as any).apiKeyRecord = { key: 'bw_ok', rpmLimit: 60, dailyLimit: 1000 };
    const { res } = makeRes();
    const next = jest.fn();

    await checkRateLimit(req, res, next as NextFunction);

    expect(next).toHaveBeenCalled();
  });

  it('returns 429 when rpm limit exceeded', async () => {
    mockRedisIncr
      .mockResolvedValueOnce(61)  // rpm count > limit
      .mockResolvedValueOnce(1);
    mockRedisExpire.mockResolvedValue(1);

    const req = makeReq();
    (req as any).apiKeyRecord = { key: 'bw_ratelimited', rpmLimit: 60, dailyLimit: 1000 };
    const { res, status, json } = makeRes();
    const next = jest.fn();

    await checkRateLimit(req, res, next as NextFunction);

    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Rate limit exceeded', window: 'per_minute' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 429 when daily limit exceeded', async () => {
    mockRedisIncr
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1001); // daily count > limit
    mockRedisExpire.mockResolvedValue(1);

    const req = makeReq();
    (req as any).apiKeyRecord = { key: 'bw_dailylimited', rpmLimit: 60, dailyLimit: 1000 };
    const { res, status, json } = makeRes();
    const next = jest.fn();

    await checkRateLimit(req, res, next as NextFunction);

    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Daily limit exceeded', window: 'per_day' }));
  });

  it('fails open (calls next) when Redis is unavailable', async () => {
    mockRedisIncr.mockRejectedValueOnce(new Error('Redis ECONNREFUSED'));

    const req = makeReq();
    (req as any).apiKeyRecord = { key: 'bw_redisdown', rpmLimit: 60, dailyLimit: 1000 };
    const { res } = makeRes();
    const next = jest.fn();

    await checkRateLimit(req, res, next as NextFunction);

    expect(next).toHaveBeenCalled();
  });
});
