import { Request, Response, NextFunction } from 'express';
import type { ServerResponse } from 'http';

/**
 * BUY-75413 (P2.3): X-Agent-* HTTP Headers for AI agent discovery.
 *
 * Spec owner: Reed (CPO). Reference: docs/P2.3-headers-spec.md (BUY-71734).
 *
 * Five additive response headers:
 *   - X-Agent-Protocol: every response, value "buywhere/v1"
 *   - X-Agent-Card:     every response, URL to the signed Agent Card
 *   - X-LLMs-Txt:       every response, URL to llms.txt
 *   - X-Agent-Index:    200 OK catalog responses only, points at the canonical
 *                       catalog query URL for the current request
 *   - X-Agent-Auth:     401/403 responses only, "Bearer; register=<key URL>"
 *
 * Mounted at the global layer so coverage includes errors, redirects, and
 * non-router paths (e.g. /health, /openapi). The two conditional headers
 * (X-Agent-Auth, X-Agent-Index) require knowledge of the final status code,
 * so they are injected via a `res.writeHead` shim that runs at the moment
 * Node.js flushes the response headers — late enough that res.statusCode
 * is set, early enough that the headers ride on the wire.
 *
 * The previous BUY-73471 implementation used a comma-separated list of protocol
 * endpoints as the X-Agent-Protocol value and pointed Card/LLMs at the apex
 * site. The P2.3 spec replaces those with the canonical versioned string
 * `buywhere/v1` and api.buywhere.ai URLs so agent clients can discover the
 * signed Agent Card consistently across hosts.
 */
const AGENT_PROTOCOL = 'buywhere/v1';
const AGENT_CARD_URL = 'https://api.buywhere.ai/.well-known/agent.json';
const AGENT_LLMS_TXT_URL = 'https://api.buywhere.ai/llms.txt';
const AGENT_AUTH_HEADER = 'Bearer; register=https://buywhere.ai/keys';
const AGENT_INDEX_BASE = 'https://api.buywhere.ai/v1/products';

// Marker symbol on the response to collect all conditional-header hooks
// registered for that response. The list grows as more middleware in the
// chain call shimResponseForConditionalHeaders (the global Auth hook is
// registered by agentHeadersMiddleware, the catalog Index hook by
// agentIndexMiddleware).
const HOOKS = Symbol('agentHeadersHooks');

function buildAgentIndexUrl(req: Request): string {
  const q = typeof req.query.q === 'string' ? req.query.q : undefined;
  const countryRaw = (req.query.country_code ?? req.query.country) as string | undefined;
  const countryCode = typeof countryRaw === 'string' ? countryRaw : undefined;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (countryCode) params.set('country_code', countryCode);
  const qs = params.toString();
  return qs ? `${AGENT_INDEX_BASE}?${qs}` : AGENT_INDEX_BASE;
}

/**
 * Patch res.writeHead so we can inject the conditional X-Agent-* headers at
 * the exact moment Node.js is about to flush the response headers. Express
 * sets `res.statusCode` before calling writeHead, so this hook sees the final
 * status and can choose which conditional header to add. Multiple hooks
 * (Auth, Index) can be registered for the same response and all run.
 */
function shimResponseForConditionalHeaders(
  res: Response,
  injectOnWriteHead: (statusCode: number) => void
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = res as any;
  if (!r[HOOKS]) {
    r[HOOKS] = [] as Array<(statusCode: number) => void>;
    // Patch the underlying writeHead exactly once. Subsequent middleware
    // additions go into r[HOOKS] and run via this same shim.
    const origWriteHead = (res.writeHead as ServerResponse['writeHead']).bind(res);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (res as any).writeHead = function patchedWriteHead(
      statusCode: number,
      statusMessage?: string | unknown,
      headersOrCb?: unknown,
      cb?: unknown
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hooks: Array<(s: number) => void> = r[HOOKS] || [];
      for (const h of hooks) h(statusCode);
      // Forward with the same signature Express used. Cast through any on
      // the call site because Node's strict TS writeHead signature doesn't
      // cover every shape Express passes (e.g. reasonPhrase + headers + cb).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fn = origWriteHead as unknown as (...args: any[]) => unknown;
      if (typeof statusMessage === 'string') {
        if (headersOrCb && typeof headersOrCb === 'object') {
          return fn(statusCode, statusMessage, headersOrCb, cb);
        }
        return fn(statusCode, statusMessage);
      }
      if (headersOrCb && typeof headersOrCb === 'object') {
        return fn(statusCode, headersOrCb);
      }
      if (typeof headersOrCb === 'function') {
        return fn(statusCode, headersOrCb);
      }
      return fn(statusCode);
    };
  }
  r[HOOKS].push(injectOnWriteHead);
}

/**
 * Global middleware. Sets the three always-on headers synchronously and
 * shims `res.writeHead` to inject `X-Agent-Auth` on 401/403 responses.
 */
export function agentHeadersMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.set('X-Agent-Protocol', AGENT_PROTOCOL);
  res.set('X-Agent-Card', AGENT_CARD_URL);
  res.set('X-LLMs-Txt', AGENT_LLMS_TXT_URL);

  shimResponseForConditionalHeaders(res, (statusCode) => {
    if (statusCode === 401 || statusCode === 403) {
      try {
        res.setHeader('X-Agent-Auth', AGENT_AUTH_HEADER);
      } catch {
        // headers already flushed (HEAD/streaming) — nothing to do.
      }
    }
  });

  next();
}

/**
 * Catalog-route middleware. Emits X-Agent-Index on 200 OK responses pointing
 * at the resolved catalog query URL. Mounted per router via `router.use(...)`
 * so it only applies to catalog-shaped routes (/v1/products, /v1/categories,
 * /v1/merchants, /v1/catalog).
 */
export function agentIndexMiddleware(req: Request, res: Response, next: NextFunction): void {
  shimResponseForConditionalHeaders(res, (statusCode) => {
    if (statusCode !== 200) return;
    try {
      res.setHeader('X-Agent-Index', buildAgentIndexUrl(req));
    } catch {
      // headers already flushed — nothing to do.
    }
  });
  next();
}