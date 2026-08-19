import { Request, Response, NextFunction } from 'express';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const onHeaders = require('on-headers');

// BUY-71736: P2.3 — agent-discovery HTTP headers on api.buywhere.ai.
//
// Five headers total:
//   - X-Agent-Protocol  : every response, constant "buywhere/v1"
//   - X-Agent-Card      : every response, constant URL
//   - X-LLMs-Txt        : every response, constant URL
//   - X-Agent-Index     : 200 catalog responses only
//   - X-Agent-Auth      : 401/403 responses only
//
// CRITICAL: this middleware must NOT modify the response body. Header
// injection only. `/.well-known/agent.json` carries a JWS-signed body
// elsewhere in the platform (P2.4); any body rewrite would invalidate
// that signature. We use `on-headers` (the same hook express uses
// internally) to set status-conditional headers immediately before
// the response headers are flushed — never after.

const PROTOCOL = 'buywhere/v1';
const AGENT_CARD_URL = 'https://api.buywhere.ai/.well-known/agent.json';
const LLMS_TXT_URL = 'https://api.buywhere.ai/llms.txt';
const AGENT_INDEX_URL =
  'https://api.buywhere.ai/v1/products/search?q={q}&country_code={cc}';
const AGENT_AUTH_VALUE =
  'Bearer; register=https://buywhere.ai/keys';

const ALL_FIVE_EXPOSE =
  'X-Agent-Protocol, X-Agent-Card, X-LLMs-Txt, X-Agent-Index, X-Agent-Auth';

// Catalog route prefixes (mounted paths). Must match the
// `app.use('/v1/products', productsRouter)` and
// `app.use('/v1/compare', ...)` mounts in server.ts.
// X-Agent-Index is set on 200 responses for these prefixes.
export const CATALOG_ROUTE_PREFIXES = [
  '/v1/products',
  '/v1/compare',
  '/v1/search',
] as const;

function isCatalogPath(pathname: string): boolean {
  return CATALOG_ROUTE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

// Merge the five agent headers into Access-Control-Expose-Headers
// without dropping existing values. Called twice: once before
// route handlers (with default expose list if absent) and once
// from on-headers (in case a route handler overwrote it).
function mergeExposeHeaders(res: Response): void {
  const existing = res.get('Access-Control-Expose-Headers');
  if (!existing) {
    res.set('Access-Control-Expose-Headers', ALL_FIVE_EXPOSE);
    return;
  }
  const have = new Set(
    existing.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
  );
  const missing = ALL_FIVE_EXPOSE.split(',').filter(
    (h) => !have.has(h.trim().toLowerCase()),
  );
  if (missing.length === 0) return;
  res.set(
    'Access-Control-Expose-Headers',
    `${existing}, ${missing.join(', ')}`,
  );
}

export function withAgentHeaders(req: Request, res: Response, next: NextFunction): void {
  // Three constants on every response. Set synchronously so they
  // are visible to any downstream middleware/handler that inspects
  // res.getHeaders().
  res.set('X-Agent-Protocol', PROTOCOL);
  res.set('X-Agent-Card', AGENT_CARD_URL);
  res.set('X-LLMs-Txt', LLMS_TXT_URL);

  mergeExposeHeaders(res);

  // on-headers fires exactly once, immediately before headers are
  // flushed to the client. Status is final; res.path/url is set.
  // Setting headers here is safe and the body is never touched.
  onHeaders(res, function agentHeadersOnHeaders(this: Response) {
    const status = this.statusCode;
    const pathname = (req as Request).path || req.originalUrl || req.url || '';

    if (status === 200 && isCatalogPath(pathname)) {
      this.setHeader('X-Agent-Index', AGENT_INDEX_URL);
    }

    if (status === 401 || status === 403) {
      this.setHeader('X-Agent-Auth', AGENT_AUTH_VALUE);
    }

    // Defensive re-merge in case a route handler overwrote the
    // expose list mid-flight (e.g. set CORS headers manually).
    const existing = this.getHeader('Access-Control-Expose-Headers');
    if (!existing) {
      this.setHeader('Access-Control-Expose-Headers', ALL_FIVE_EXPOSE);
    } else {
      const existingStr = String(existing);
      const have = new Set(
        existingStr.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
      );
      const missing = ALL_FIVE_EXPOSE.split(',').filter(
        (h) => !have.has(h.trim().toLowerCase()),
      );
      if (missing.length > 0) {
        this.setHeader(
          'Access-Control-Expose-Headers',
          `${existingStr}, ${missing.join(', ')}`,
        );
      }
    }
  });

  next();
}

// Exported for unit tests.
export const _internals = {
  PROTOCOL,
  AGENT_CARD_URL,
  LLMS_TXT_URL,
  AGENT_INDEX_URL,
  AGENT_AUTH_VALUE,
  ALL_FIVE_EXPOSE,
  isCatalogPath,
  mergeExposeHeaders,
};