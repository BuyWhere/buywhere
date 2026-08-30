import { Request, Response, NextFunction } from 'express';
import { db, redis } from '../config';
import { semanticRegister } from '../lib/semanticCache';
import { trackApiUsage } from '../analytics/posthog';
import { hashKey } from './apiKey';

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
 *
 * BUY-74597: timeout/degraded empty responses are NOT true zero-result searches —
 * logging them as 0 poisons the zero-result KPI. Log null instead.
 */
function extractReturnedProductIds(body: unknown, statusCode: number): string[] | null {
  if (statusCode >= 400) return null;
  if (!body || typeof body !== 'object') return null;

  const b = body as Record<string, unknown>;
  if (b.jsonrpc === '2.0') {
    const result = b.result;
    if (result && typeof result === 'object') {
      const r = result as Record<string, unknown>;
      if (Array.isArray(r.content) && r.content.length === 1) {
        const content = r.content[0] as Record<string, unknown>;
        if (content.type === 'text' && typeof content.text === 'string') {
          try {
            return extractReturnedProductIds(JSON.parse(content.text), 200);
          } catch { /* not JSON — skip */ }
        }
      }
    }
    return null;
  }

  const candidates = [b.data, b.results, b.products, b.items]
    .find((value): value is Array<Record<string, unknown>> => Array.isArray(value));
  if (!candidates) return null;

  const ids = candidates
    .map((item) => item && typeof item === 'object' ? (item as Record<string, unknown>).id : null)
    .filter((id): id is string | number => typeof id === 'string' || typeof id === 'number')
    .map(String)
    .slice(0, 100);

  return ids.length > 0 ? ids : null;
}

/**
 * BUY-74597: extract the degraded_kind classification from the response meta so
 * `silently_empty_rate_24h` and similar KPIs can subtract degraded responses
 * from the true-empty bucket. Mirrors the field name on SearchMeta.degraded_kind.
 */
function extractDegradedKind(body: unknown, statusCode: number): string | null {
  if (statusCode >= 400) return null;
  if (!body || typeof body !== 'object') return null;

  const b = body as Record<string, unknown>;
  let meta: Record<string, unknown> | undefined;
  if (b.jsonrpc === '2.0') {
    const result = b.result;
    if (result && typeof result === 'object') {
      const r = result as Record<string, unknown>;
      if (Array.isArray(r.content) && r.content.length === 1) {
        const content = r.content[0] as Record<string, unknown>;
        if (content.type === 'text' && typeof content.text === 'string') {
          try {
            const parsed = JSON.parse(content.text);
            return extractDegradedKind(parsed, 200);
          } catch { return null; }
        }
      }
    }
    return null;
  }
  meta = (b.meta && typeof b.meta === 'object') ? b.meta as Record<string, unknown> : undefined;
  if (!meta) return null;
  const kind = meta.degraded_kind;
  if (typeof kind === 'string' && kind !== '' && kind !== 'unknown') return kind;
  // Fallback: legacy degraded=true without a kind is treated as 'upstream_exception'.
  if (meta.degraded === true && Array.isArray(b.data) && b.data.length === 0) return 'upstream_exception';
  return null;
}

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

  // Timeout/degraded empty responses are NOT true zero-result searches —
  // logging them as 0 poisons the zero-result KPI. Log null instead.
  const meta = b.meta as Record<string, unknown> | undefined;
  if (meta && meta.degraded === true && Array.isArray(b.data) && b.data.length === 0) return null;
  if (Array.isArray(b.data)) return b.data.length;
  if (Array.isArray(b.results)) return b.results.length;
  if (b.data && typeof b.data === 'object') return 1;

  return null;
}

/**
 * Express middleware that logs authenticated API requests to the query_log table.
 * Fire-and-forget — never blocks the response.
 *
 * Attach AFTER agentDetectMiddleware and requireApiKey so req.agentInfo and
 * req.apiKeyRecord are populated.
 */

// WP5 (2026-08-22): shopping_job_id — agents tag a shopping session/job so
// downstream clicks and conversions attribute back to it. Accepted on any
// logged endpoint; must be URL-safe, <=128 chars, else ignored.
function extractJobId(req: Request): string | null {
  const v = req.query.shopping_job_id;
  if (typeof v !== 'string' || v.length === 0 || v.length > 128) return null;
  return /^[A-Za-z0-9._~:-]+$/.test(v) ? v : null;
}

export function queryLogMiddleware(endpoint: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now();

    // Intercept res.json to capture result count from the response body
    // before it's sent to the client (the finish handler reads res.locals).
    const originalJson = res.json.bind(res);
    res.json = function (body: unknown) {
      res.locals.resultCount = extractResultCount(body, res.statusCode);
      res.locals.returnedProductIds = extractReturnedProductIds(body, res.statusCode);
      res.locals.degradedKind = extractDegradedKind(body, res.statusCode);
      // WP5: thread shopping_job_id into every click_url (runs after the route's
      // cache write serialized the body, so the decoration is never cached).
      const jobId = extractJobId(req);
      if (jobId && body && typeof body === 'object') {
        const data = (body as Record<string, unknown>).data;
        if (Array.isArray(data)) {
          for (const item of data) {
            const it = item as Record<string, unknown>;
            if (typeof it.click_url === 'string' && !it.click_url.includes('job_id=')) {
              it.click_url = `${it.click_url}&job_id=${encodeURIComponent(jobId)}`;
            }
          }
        }
      }
      return originalJson(body);
    };

    // Hook into response finish to capture status code, timing, and result count
    res.once('finish', () => {
      // Central semantic-cache registration (2026-08-06): the search route stashes
      // scope/qNorm/vector/cacheKey on cache miss; every successful store path
      // (tier, archive, fallback) then gets registered here exactly once.
      if (
        res.locals.semScope && res.locals.semQNorm && res.locals.semCacheKey &&
        res.statusCode === 200 && (res.locals.resultCount ?? 0) > 0 &&
        res.locals.cacheHit !== true
      ) {
        semanticRegister(
          redis, res.locals.semScope, res.locals.semQNorm,
          (res.locals.semVec as string | null) ?? null, res.locals.semCacheKey
        ).catch(() => {});
      }
      const apiKeyRecord = req.apiKeyRecord;
      // Log all requests — unauthenticated ones recorded with null api_key_id
      // so we capture total demand even before API key adoption ramps up.

      const responseTimeMs = Date.now() - start;
      const isAgent = classifyIsAgent(req);

      // Extract query text from common params
      const queryText = (req.query.q as string) || (req.query.ids as string) || null;

      db.query(
        `INSERT INTO query_log
          (api_key_id, agent_name, agent_framework, sdk_language, is_agent,
           endpoint, query_text, result_count, returned_product_ids, response_time_ms,
           status_code, ip_address, user_agent, cache_hit, job_id, degraded_kind)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::bigint[], $10, $11, $12, $13, $14, $15, $16)`,
        [
          apiKeyRecord?.id ?? null,
          apiKeyRecord?.agentName ?? null,
          req.agentInfo?.framework || 'unknown',
          req.agentInfo?.sdkLanguage || 'unknown',
          isAgent,
          endpoint,
          queryText,
          res.locals.resultCount ?? null,
          res.locals.returnedProductIds ?? null,
          responseTimeMs,
          res.statusCode,
          req.ip || null,
          (req.headers['user-agent'] || '').slice(0, 500),
          res.locals.cacheHit ?? null,
          extractJobId(req),
          res.locals.degradedKind ?? null,
        ]
      ).catch((err) => {
        // Fire-and-forget — don't crash on log failure
        console.error('[queryLog] INSERT failed:', err.message);
      });

      // BUY-22733: source-of-truth usage telemetry to PostHog.
      // Skip unauthenticated requests — no api_key_id to attribute.
      // BUY-31298: route handlers set res.locals.queryIntent / productCategories /
      // signupChannel / sourcePage so this single event carries all analytics context.
      if (apiKeyRecord?.id) {
        try {
          trackApiUsage({
            apiKeyId: apiKeyRecord.id,
            keyHash: apiKeyRecord.key ? hashKey(apiKeyRecord.key) : null,
            isInternal: apiKeyRecord.isInternal === true,
            agentName: apiKeyRecord.agentName ?? null,
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
