import { Request, Response, NextFunction } from 'express';
import { recordLatencySample } from './p95';

const TRACKED_ENDPOINTS = [
  '/mcp',
  '/api/mcp',
  '/v1/products',
  '/v2/products',
  '/v1/categories',
  '/v1/search',
];

function extractMarketFromRequest(req: Request): string | null {
  const marketFromQuery = req.query.market as string;
  if (marketFromQuery && ['sg', 'us', 'my', 'vn', 'th'].includes(marketFromQuery.toLowerCase())) {
    return marketFromQuery.toLowerCase();
  }

  const marketFromHeader = req.headers['x-market'] as string;
  if (marketFromHeader && ['sg', 'us', 'my', 'vn', 'th'].includes(marketFromHeader.toLowerCase())) {
    return marketFromHeader.toLowerCase();
  }

  const marketFromPath = req.path.match(/\/(?:sg|us|my|vn|th)(?:\/|$)/i);
  if (marketFromPath) {
    return marketFromPath[0].replace(/[^a-z]/g, '').toLowerCase();
  }

  if (req.path.startsWith('/mcp') || req.path.startsWith('/api/mcp')) {
    const body = req.body as any;
    if (body?.params?.country_code) {
      const countryCode = body.params.country_code.toLowerCase();
      if (['sg', 'us', 'my', 'vn', 'th'].includes(countryCode)) {
        return countryCode;
      }
    }
  }

  return null;
}

function shouldTrackEndpoint(req: Request): boolean {
  const path = req.path;
  return TRACKED_ENDPOINTS.some(endpoint => path.startsWith(endpoint));
}

/**
 * Map a request path to the short endpoint discriminator used by the
 * buywhere-monitoring-api /api/monitoring/p95/history?endpoint= query.
 *
 * BUY-54722: without this normalization the rows in monitoring.p95_latency
 * store the full path ('/v1/products/search', '/v1/products/:id/similar')
 * but the monitoring-api filter expects the short discriminator ('search',
 * 'similar'). Without this, the embedding-alerts p95 check would always
 * see no data for search/similar.
 */
function normalizeEndpoint(path: string): string {
  if (path.includes('/similar')) return 'similar';
  if (path.includes('/search')) return 'search';
  return path;
}

export function latencyMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!shouldTrackEndpoint(req)) {
    return next();
  }

  const startTime = Date.now();
  const market = extractMarketFromRequest(req);
  const endpoint = normalizeEndpoint(req.path);

  const originalSend = res.send.bind(res);
  res.send = function(this: Response, body?: any): Response {
    const endTime = Date.now();
    const latencyMs = endTime - startTime;

    if (market) {
      recordLatencySample(market, endpoint, latencyMs);
    }

    return originalSend(body);
  } as Response['send'];

  next();
}

export async function computeP95ForAllMarkets(): Promise<void> {
  const { computeAndStoreP95 } = await import('./p95');
  const markets = ['sg', 'us', 'my', 'vn', 'th'];
  // BUY-54722: short endpoint discriminators (must match what latencyMiddleware
  // writes via normalizeEndpoint). Using 'mcp' for /mcp + /api/mcp, 'products'
  // for /v1/products list+deals, 'search' for /v1/products/search,
  // 'similar' for /v1/products/:id/similar, 'categories' for /v1/categories.
  const endpoints = ['mcp', 'products', 'categories', 'search', 'similar'];

  for (const market of markets) {
    for (const endpoint of endpoints) {
      try {
        await computeAndStoreP95(market, endpoint);
      } catch (error) {
        console.error(`[P95] Error computing P95 for ${market}:${endpoint}:`, error);
      }
    }
  }
}
