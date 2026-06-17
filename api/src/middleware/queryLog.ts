import { Request, Response, NextFunction } from 'express';
import { db } from '../config';
import { trackApiUsage } from '../analytics/posthog';

// Known human User-Agent patterns — browsers, Googlebot, etc.
const HUMAN_UA_PATTERNS = [
  /mozilla/i,
  /chrome/i,
  /safari/i,
  /firefox/i,
  /edge/i,
  /opera/i,
  /googlebot/i,
  /bingbot/i,
];

/**
 * Classify whether a request is from an AI agent or a human browser.
 * Heuristic: if the agent detection middleware identified a known framework,
 * or the User-Agent doesn't match any browser pattern, treat it as an agent.
 */
function classifyIsAgent(req: Request): boolean {
  const framework = req.agentInfo?.framework;
  // Known agent frameworks are always agents
  if (framework && framework !== 'unknown') return true;

  const ua = req.headers['user-agent'] || '';
  // No User-Agent at all → likely a programmatic client
  if (!ua) return true;
  // X-Agent-Framework header present → agent
  if (req.headers['x-agent-framework']) return true;
  // If UA matches a browser pattern, it's likely human
  if (HUMAN_UA_PATTERNS.some((p) => p.test(ua))) return false;
  // Default: treat as agent (this is an agent-first API)
  return true;
}

/**
 * Extract result count from a response body.
 * Handles standard REST and JSON-RPC MCP envelopes.
 *
 * - Array data/results → length
 * - Single object data → 1 (product lookup, category detail)
 * - Error responses (4xx+) → null
 * - JSON-RPC → unwrap text content and recurse
 */
function extractResultCount(body: unknown, statusCode: number): number | null {
  if (statusCode >= 400) return null;
  if (!body || typeof body !== 'object') return null;

  const b = body as Record<string, unknown>;

  // JSON-RPC MCP envelope — unwrap text content
  if (b.jsonrpc === '2.0') {
    const result = b.result;
    if (result && typeof result === 'object') {
      const r = result as Record<string, unknown>;
      if (Array.isArray(r.content) && r.content.length === 1) {
        const content = r.content[0] as Record<string, unknown>;
        if (content.type === 'text' && typeof content.text === 'string') {
          try {
            const inner = JSON.parse(content.text);
            return extractResultCount(inner, 200);
          } catch { /* not JSON — skip */ }
        }
      }
    }
    return null;
  }

  if (Array.isArray(b.data)) return b.data.length;
  if (Array.isArray(b.results)) return b.results.length;
  if (b.data && typeof b.data === 'object') return 1;

  return null;
}

/**
 * Extract the ordered list of product IDs from a response body.
 * BUY-52473 [Wave 1/4.1]: same id-space and order as the response `results`
 * (or `data`) array; index 0 = top result. Returns the raw id values — pg
 * coerces strings/numbers into bigint[] on the server, which matches the
 * default int8 type parser behaviour (bigint → string).
 *
 * Returns null when the response is an error, the body is malformed, or
 * the envelope doesn't carry a product array (single product lookups,
 * /merchants, /categories, price-history, etc.).
 */
function extractProductIds(body: unknown, statusCode: number): unknown[] | null {
  if (statusCode >= 400) return null;
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;

  const arrayKey = Array.isArray(b.results) ? 'results' : Array.isArray(b.data) ? 'data' : null;
  if (!arrayKey) return null;

  const arr = b[arrayKey] as unknown[];
  if (!Array.isArray(arr) || arr.length === 0) return [];

  const ids: unknown[] = [];
  for (const item of arr) {
    if (item && typeof item === 'object' && 'id' in (item as Record<string, unknown>)) {
      const id = (item as Record<string, unknown>).id;
      if (id != null) ids.push(id);
    }
  }
  return ids;
}

/**
 * Resolve the country code for a request. Prefer an explicit
 * `req.countryCode` (set by geo / locale middleware if present), then the
 * canonical `country_code` query param, then the legacy `country` alias.
 * Returns the 2-letter code uppercased, or null if absent.
 */
function resolveCountryCode(req: Request): string | null {
  const fromMiddleware = (req as { countryCode?: string }).countryCode;
  if (typeof fromMiddleware === 'string' && fromMiddleware.length > 0) {
    return fromMiddleware.toUpperCase();
  }
  const fromQuery =
    (req.query.country_code as string | undefined) || (req.query.country as string | undefined);
  if (typeof fromQuery === 'string' && fromQuery.length > 0) {
    return fromQuery.toUpperCase();
  }
  return null;
}

/**
 * Express middleware that logs authenticated API requests to the query_log table.
 * Fire-and-forget — never blocks the response.
 *
 * Attach AFTER agentDetectMiddleware and requireApiKey so req.agentInfo and
 * req.apiKeyRecord are populated.
 */
export function queryLogMiddleware(endpoint: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now();

    // Intercept res.json to capture result count + ordered product IDs from
    // the response body before it's sent to the client (the finish handler
    // reads res.locals).
    const originalJson = res.json.bind(res);
    res.json = function (body: unknown) {
      res.locals.resultCount = extractResultCount(body, res.statusCode);
      // BUY-52473: ordered product IDs, same id-space and order as the
      // response `results` (or `data`) array. Index 0 = top result.
      res.locals.returnedProductIds = extractProductIds(body, res.statusCode);
      return originalJson(body);
    };

    // Hook into response finish to capture status code, timing, and result count
    res.once('finish', () => {
      const apiKeyRecord = req.apiKeyRecord;
      // Log all requests — unauthenticated ones recorded with null api_key_id
      // so we capture total demand even before API key adoption ramps up.

      const responseTimeMs = Date.now() - start;
      const isAgent = classifyIsAgent(req);

      // Extract query text from common params
      const queryText = (req.query.q as string) || (req.query.ids as string) || null;

      // BUY-52473: country code is 2-letter ISO from req.countryCode
      // (geo middleware) or the country_code/country query param.
      const countryCode = resolveCountryCode(req);

      db.query(
        `INSERT INTO query_log
          (api_key_id, agent_name, agent_framework, sdk_language, is_agent,
           endpoint, query_text, result_count, response_time_ms,
           status_code, ip_address, user_agent,
           returned_product_ids, country_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          apiKeyRecord?.id ?? null,
          apiKeyRecord?.agentName ?? null,
          req.agentInfo?.framework || 'unknown',
          req.agentInfo?.sdkLanguage || 'unknown',
          isAgent,
          endpoint,
          queryText,
          res.locals.resultCount ?? null,
          responseTimeMs,
          res.statusCode,
          req.ip || null,
          (req.headers['user-agent'] || '').slice(0, 500),
          (res.locals.returnedProductIds as unknown[] | null) ?? null,
          countryCode,
        ]
      ).catch(() => {
        // Fire-and-forget — don't crash on log failure
      });

      // BUY-22733: source-of-truth usage telemetry to PostHog.
      // Skip unauthenticated requests — no api_key_id to attribute.
      // BUY-31298: route handlers set res.locals.queryIntent / productCategories /
      // signupChannel / sourcePage so this single event carries all analytics context.
      if (apiKeyRecord?.id) {
        try {
          trackApiUsage({
            apiKeyId: apiKeyRecord.id,
            endpoint,
            method: req.method,
            tier: apiKeyRecord.tier,
            resultStatus: res.statusCode,
            latencyMs: responseTimeMs,
            toolName: (res.locals.mcpToolName as string) || null,
            queryIntent: (res.locals.queryIntent as string) || null,
            productCategories: (res.locals.productCategories as string[]) || null,
            signupChannel: (res.locals.signupChannel as string) || null,
            sourcePage: (res.locals.sourcePage as string) || null,
          });
        } catch {
          // PostHog client errors must never affect the response.
        }
      }
    });

    next();
  };
}
