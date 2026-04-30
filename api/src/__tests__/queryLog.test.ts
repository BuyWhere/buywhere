const mockDbQuery = jest.fn().mockResolvedValue({ rows: [] });

jest.mock('../config', () => ({
  db: { query: mockDbQuery },
  redis: { get: jest.fn(), set: jest.fn(), incr: jest.fn(), expire: jest.fn() },
  FREE_TIER: { rpm: 60, daily: 1000 },
}));

import { Request, Response, NextFunction } from 'express';
import { queryLogMiddleware } from '../middleware/queryLog';

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    query: {},
    ip: '127.0.0.1',
    ...overrides,
  } as unknown as Request;
}

function makeRes(): { res: Response; on: jest.Mock; statusCode: number } {
  const on = jest.fn((event: string, handler: () => void) => {
    if (event === 'finish') handler(); // fire immediately for test
  });
  const res = { on, statusCode: 200 } as unknown as Response;
  return { res, on, statusCode: 200 };
}

describe('queryLogMiddleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDbQuery.mockResolvedValue({ rows: [] });
  });

  it('calls next() immediately', () => {
    const req = makeReq();
    const { res } = makeRes();
    const next = jest.fn();

    const middleware = queryLogMiddleware('test.endpoint');
    middleware(req, res, next as NextFunction);

    expect(next).toHaveBeenCalled();
  });

  it('logs to query_log on response finish', () => {
    const req = makeReq({
      headers: { 'user-agent': 'python-requests/2.28' },
      query: { q: 'iphone' },
    });
    (req as any).apiKeyRecord = {
      id: 'key-1',
      key: 'bw_test',
      agentName: 'TestBot',
      tier: 'free',
      rpmLimit: 60,
      dailyLimit: 1000,
      signupChannel: null,
      attributionSource: null,
    };
    (req as any).agentInfo = { framework: 'custom', version: '', sdkLanguage: 'python' };

    const { res } = makeRes();
    const next = jest.fn();

    const middleware = queryLogMiddleware('products.search');
    middleware(req, res, next as NextFunction);

    expect(mockDbQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO query_log'),
      expect.arrayContaining(['key-1', 'TestBot', 'products.search', 'iphone'])
    );
  });

  it('logs with null api_key_id for unauthenticated requests', () => {
    const req = makeReq({ headers: { 'user-agent': 'curl/7.88' } });
    // No apiKeyRecord attached
    const { res } = makeRes();
    const next = jest.fn();

    const middleware = queryLogMiddleware('products.search');
    middleware(req, res, next as NextFunction);

    const callParams = mockDbQuery.mock.calls[0][1] as unknown[];
    expect(callParams[0]).toBeNull(); // api_key_id should be null
  });

  it('classifies browser UA as non-agent', () => {
    const req = makeReq({
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      },
    });
    (req as any).agentInfo = { framework: 'unknown', version: '', sdkLanguage: 'unknown' };

    const { res } = makeRes();
    const next = jest.fn();

    const middleware = queryLogMiddleware('categories.list');
    middleware(req, res, next as NextFunction);

    const callParams = mockDbQuery.mock.calls[0][1] as unknown[];
    const isAgent = callParams[4]; // is_agent column
    expect(isAgent).toBe(false);
  });

  it('classifies python UA as agent', () => {
    const req = makeReq({
      headers: { 'user-agent': 'python-requests/2.28' },
    });
    (req as any).agentInfo = { framework: 'unknown', version: '', sdkLanguage: 'unknown' };

    const { res } = makeRes();
    const next = jest.fn();

    const middleware = queryLogMiddleware('products.search');
    middleware(req, res, next as NextFunction);

    const callParams = mockDbQuery.mock.calls[0][1] as unknown[];
    const isAgent = callParams[4];
    expect(isAgent).toBe(true);
  });

  it('classifies requests with X-Agent-Framework header as agent', () => {
    const req = makeReq({
      headers: {
        'user-agent': 'Mozilla/5.0 Chrome/120',
        'x-agent-framework': 'langchain',
      },
    });
    (req as any).agentInfo = { framework: 'langchain', version: '0.1', sdkLanguage: 'python' };

    const { res } = makeRes();
    const next = jest.fn();

    const middleware = queryLogMiddleware('products.search');
    middleware(req, res, next as NextFunction);

    const callParams = mockDbQuery.mock.calls[0][1] as unknown[];
    const isAgent = callParams[4];
    expect(isAgent).toBe(true);
  });

  it('handles DB write failure gracefully (fire-and-forget)', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('DB write failed'));

    const req = makeReq();
    const { res } = makeRes();
    const next = jest.fn();

    const middleware = queryLogMiddleware('test');
    // Should not throw even if DB fails
    expect(() => middleware(req, res, next as NextFunction)).not.toThrow();
    expect(next).toHaveBeenCalled();
  });
});
