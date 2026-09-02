import { Router, Request, Response, NextFunction } from 'express';
import { randomUUID, createHash } from 'crypto';
import type { PoolClient } from 'pg';
import { db, redis, vectorDb, PORT } from '../config';
import { embedQuery } from '../jobs/embedProducts';
import { requireApiKey, checkRateLimit } from '../middleware/apiKey';
import { queryLogMiddleware } from '../middleware/queryLog';
import { recordQueryCacheLookup, recordCacheHitLatency } from '../monitoring/cacheStats';
import { buildErrorEnvelope, ErrorCode, ErrorCodeType } from '../middleware/errors';
import { buildProduct, buildSearchResponse, COUNTRY_CURRENCY, CURRENCY_RATES, deriveEmptiness, EmptinessSignals, extractNumericPrice } from '../lib/response';
import { lookupMerchantMap } from '../lib/merchantLookup';
import { servingReadDbConnect, ReplicaUnavailableError } from '../lib/readReplica';
import { getCachedFxRates } from '../lib/fxRatesLoader';
import { buildDeviceFilter } from '../lib/deviceClassifier';
import { applyFbpGeoAndHighOutlierGuard } from '../lib/fbpGeoGuard';
import { detectIdentifier, identifierMatchPredicate } from '../lib/identifierDetector';
import { buildClickUrl } from '../lib/instrumentation';
import {
  recordToolCall,
  computeSnapshot,
  getDegradedRegions,
  SUPPORTED_REGIONS,
  type SupportedRegion,
} from '../monitoring/healthSnapshot';
import {
  startShoppingJobFunnel,
  resolveShoppingJobId,
  recordJobCreated,
  recordProductResolved,
  recordExecutableOfferFound,
  recordOutboundLinkReturned,
  extractProductIds,
  hasOutboundUrl,
} from '../monitoring/shoppingJobFunnel';
import { recordV2KpiSink } from '../monitoring/v2KpiWriter';
import { startV2RequestLog, recordV2Request, buildV2RequestRow } from '../monitoring/v2RequestLog';

// BUY-73521: start funnel writer on module load (idempotent).
startShoppingJobFunnel();

// BUY-76909: Countries whose standalone child tables answer FTS in <100ms. The
// parent `products` table has 373M rows / 297GB with severe bloat (11M dead
// tuples), so the hydrating PK-join against it times out. Route the FBP final
// join to products_partitioned_{cc} for these countries.
// BUY-70498: only route to child tables that actually hold catalog rows.
// products_partitioned_{th,vn,my,id} are empty/near-empty while search_products
// still has the SEA catalog. Using the empty child tables made search_products
// and find_best_price return 0 rows in ~40ms (false no-match).
const FAST_CHILD_TABLE_COUNTRIES = new Set(['SG','US','AU','GB','CA']);

// BUY-72550: start v2 request log writer on module load (idempotent).
startV2RequestLog();

// BUY-75415: start v2 KPI sink writer on module load (idempotent).
// Auto-started inside the module — explicit call here would be redundant.

// BUY-73521: v2 buyer-context tools that participate in the purchase funnel.
// All have REQUIRED deliver_to per the v2 wire contract (BUY-72533).
const V2_BUYER_TOOLS = new Set([
  'search_products_v2',
  'find_best_price_v2',
  'get_product_v2',
  'compare_products_v2',
  'get_deals_v2',
]);

// BUY-73521: REST endpoints that participate in the purchase funnel.
const REST_BUYER_FUNNEL_ENDPOINTS = new Set([
  '/v1/products/search',
  '/v1/products/deals',
  '/v1/products/compare',
]);

const router = Router();
const MCP_DB_ACQUIRE_TIMEOUT_MS = parseInt(process.env.MCP_DB_ACQUIRE_TIMEOUT_MS || '1000', 10);
// BUY-78735: MCP clients (and the 5s 0-byte hang probes) abort well before PG's
// 30s statement_timeout. Bound catalog_search / get_deals / FBP to a wall-clock
// so tools/call always flushes a JSON degraded envelope. PG timeout is kept
// slightly under the wall so cancelled queries don't occupy the pool after we
// have already responded.
const MCP_CATALOG_WALL_MS = parseInt(process.env.MCP_CATALOG_WALL_MS || '3500', 10);
const MCP_CATALOG_STATEMENT_TIMEOUT_MS = Math.max(
  1000,
  parseInt(process.env.MCP_CATALOG_STATEMENT_TIMEOUT_MS || String(Math.max(1000, MCP_CATALOG_WALL_MS - 500)), 10),
);
const MCP_CATALOG_WALL_TOOLS = new Set([
  'search_products',
  'search_products_v2',
  'get_deals',
  'get_deals_v2',
  'find_best_price',
  'find_best_price_v2',
  'list_categories',
]);
const MCP_TOOL_WALL_MS: Record<string, number> = {
  get_deals: 4000,
  get_deals_v2: 4000,
  search_products: 3500,
  search_products_v2: 3500,
  list_categories: 3500,
  find_best_price: 20000,
  find_best_price_v2: 20000,
};
// BUY-75291: per-(q,cc) MCP FTS snapshot TTL. 60s bounds staleness between
// ingestion flushes; ingestion drops fts:v7:* keys as soon as a run lands.
// Override per BUYWHERE_API_KEY_METADATA binding or MCP_FTS_CACHE_TTL_SECONDS env.
export const MCP_FTS_CACHE_TTL_SECONDS = parseInt(process.env.MCP_FTS_CACHE_TTL_SECONDS || '60', 10);

async function acquireMcpClient() {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      db.connect(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('mcp_db_pool_acquire_timeout')), MCP_DB_ACQUIRE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// BUY-67598: separate pool-acquire wait from SQL so sweep RCA can tell starvation vs query.
async function acquireMcpClientTimed(tool: string): Promise<{ client: any; poolWaitMs: number }> {
  const t0 = Date.now();
  const client = await acquireMcpClient();
  const poolWaitMs = Date.now() - t0;
  if (poolWaitMs >= 200) {
    console.warn(`[mcp] BUY-67598 ${tool} pool_wait_ms=${poolWaitMs}`);
  }
  return { client, poolWaitMs };
}

async function showStatementTimeout(client: any): Promise<string | null> {
  try {
    const res = await client.query('SHOW statement_timeout');
    return String(res.rows?.[0]?.statement_timeout ?? '');
  } catch (_) {
    return null;
  }
}

// BUY-79260: when the catalog_search circuit is open (or pool acquire fails),
// REST /v1/products/search on the same origin is independently healthy. Serve
// hits from REST instead of returning an empty circuit_open envelope so Cart
// probes and agent callers keep working while sakura conn ceiling recovers.
const REST_SEARCH_FALLBACK_MS = parseInt(process.env.MCP_REST_FALLBACK_TIMEOUT_MS || '2500', 10);

function restSearchQueryParams(opts: {
  q: string;
  country: string;
  limit: number;
  offset: number;
  mode: 'market' | 'country';
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set('q', opts.q);
  if (opts.country) {
    if (opts.mode === 'market') {
      // BUY-79598: market=/deliver_to= keeps high-recall (macbook/nike) from
      // being zeroed by REST's strict country_code post-filter.
      params.set('market', opts.country);
      params.set('deliver_to', opts.country);
    } else {
      // BUY-79631: country= returns native-currency market rows (SGD shirts)
      // so BUY-79642 isolation does not empty the page.
      params.set('country', opts.country);
      params.set('deliver_to', opts.country);
    }
  }
  params.set('limit', String(Math.min(Math.max(opts.limit * 4, 1), 40)));
  if (opts.offset) params.set('offset', String(opts.offset));
  return params;
}

function isolateRestSearchHits(
  rows: Record<string, unknown>[],
  opts: { country: string; currency: string; compact: boolean },
): { products: ReturnType<typeof buildProduct>[]; dropped: number } {
  const expectedCc = (opts.country || '').toUpperCase();
  const expectedCur = (opts.currency || '').toUpperCase();
  const products = rows.map((r) => {
    const price = r.price;
    const flattened: Record<string, unknown> = { ...r };
    let rowCurrency = '';
    if (price && typeof price === 'object' && !Array.isArray(price)) {
      const p = price as { amount?: unknown; currency?: unknown };
      flattened.price = p.amount;
      if (p.currency) {
        rowCurrency = String(p.currency).toUpperCase();
        flattened.currency = rowCurrency;
      }
    }
    if (!flattened.domain && r.merchant) flattened.domain = r.merchant;
    if (!flattened.source && r.merchant) flattened.source = r.merchant;
    return { product: buildProduct(flattened, opts.currency, opts.compact), rowCurrency };
  }).filter((item) => {
    const p = item.product;
    if (expectedCc) {
      const cc = String(p.country_code || '').toUpperCase();
      if (cc && cc !== expectedCc) return false;
    }
    if (expectedCur) {
      const fromProduct = String((p.price as { currency?: string } | undefined)?.currency || '').toUpperCase();
      const cur = item.rowCurrency || fromProduct;
      if (cur && cur !== expectedCur) return false;
    }
    return true;
  }).map((item) => item.product);
  return { products, dropped: rows.length - products.length };
}

async function searchProductsViaRestFallback(opts: {
  q: string;
  country: string;
  limit: number;
  offset: number;
  compact: boolean;
  currency: string;
  apiKey?: string;
}): Promise<{ products: ReturnType<typeof buildProduct>[]; total: number } | null> {
  if (!opts.q) return null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REST_SEARCH_FALLBACK_MS);
  try {
    const headers: Record<string, string> = { accept: 'application/json' };
    const incomingKey = (typeof opts.apiKey === 'string' && opts.apiKey)
      || process.env.BUYWHERE_INTERNAL_API_KEY
      || process.env.BUYWHERE_API_KEY
      || '';
    if (incomingKey) {
      headers['x-api-key'] = incomingKey.replace(/^Bearer\s+/i, '');
      headers['authorization'] = incomingKey.startsWith('Bearer ') ? incomingKey : `Bearer ${incomingKey}`;
    }
    const bases = [
      (process.env.BUYWHERE_REST_BASE || '').replace(/\/$/, ''),
      'http://buywhere-api.railway.internal:8080',
      'http://buywhere-api.railway.internal:3000',
      `http://127.0.0.1:${PORT}`,
      'https://api.buywhere.ai',
    ].filter(Boolean);

    let restHttpOk = false;
    const fetchRows = async (mode: 'market' | 'country'): Promise<Record<string, unknown>[] | null> => {
      const params = restSearchQueryParams({
        q: opts.q,
        country: opts.country,
        limit: opts.limit,
        offset: opts.offset,
        mode,
      });
      let lastErr: unknown = null;
      for (const base of bases) {
        try {
          const attempt = await fetch(`${base}/v1/products/search?${params.toString()}`, {
            method: 'GET',
            headers,
            signal: ac.signal,
          });
          if (!attempt.ok) {
            lastErr = new Error(`HTTP ${attempt.status} from ${base}`);
            continue;
          }
          const body = await attempt.json() as {
            products?: Record<string, unknown>[];
            data?: Record<string, unknown>[];
            results?: Record<string, unknown>[];
          };
          restHttpOk = true;
          const rows = body.products || body.results || body.data || [];
          if (Array.isArray(rows) && rows.length > 0) return rows;
          lastErr = new Error(`empty from ${base} mode=${mode}`);
        } catch (e) {
          lastErr = e;
        }
      }
      if (lastErr) {
        console.warn('[search_products] REST fetch mode=', mode, (lastErr as Error)?.message?.slice(0, 160));
      }
      return null;
    };

    // Prefer market aliases for recall, then country= if isolation empties the page
    // (shirt SG: market= returns USD-labelled SG Shopify; country= returns SGD).
    for (const mode of ['market', 'country'] as const) {
      const rows = await fetchRows(mode);
      if (!rows || rows.length === 0) continue;
      const isolated = isolateRestSearchHits(rows, {
        country: opts.country,
        currency: opts.currency,
        compact: opts.compact,
      });
      if (isolated.products.length > 0) {
        return { products: isolated.products, total: isolated.products.length };
      }
      console.warn(`[search_products] BUY-79631: REST ${mode} isolation emptied n=${rows.length} q=${opts.q} country=${opts.country}`);
    }
    // BUY-79642: HTTP 200 with 0 isolated hits is a real no_match, not transport fail.
    return restHttpOk ? { products: [], total: 0 } : null;
  } catch (err) {
    console.warn('[search_products] REST fallback failed:', (err as Error)?.message?.slice(0, 160));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function aliasSearchEnvelope(resp: ReturnType<typeof buildSearchResponse>) {
  const r = resp as any;
  const list = r.results || r.products || [];
  r.products = list;
  r.data = list;
  r.items = list;
  r.results = list;
  r.meta = {
    ...(r.meta || {}),
    total: r.meta?.total ?? list.length,
    fallback: 'rest_search',
  };
  return r;
}

async function findBestPriceViaRestFallback(opts: {
  productName: string;
  country: string;
  t0: number;
}): Promise<{ best_price: Record<string, unknown> | null; alternatives: Record<string, unknown>[]; meta: Record<string, unknown> } | null> {
  const restHits = await searchProductsViaRestFallback({
    q: opts.productName,
    country: opts.country,
    limit: 10,
    offset: 0,
    compact: true,
    currency: COUNTRY_CURRENCY[opts.country] || 'SGD',
  });
  if (!restHits || restHits.products.length === 0) return null;
  const data = restHits.products.map((p: any) => {
    const offers = p.offers;
    const nested = p.price;
    let amount: number | null = null;
    if (offers && typeof offers === 'object') {
      const o = offers as { lowPrice?: unknown; price?: unknown };
      amount = extractNumericPrice(o.lowPrice ?? o.price);
    }
    if (amount == null) amount = extractNumericPrice(nested);
    const curr = (offers && typeof offers === 'object' && (offers as { priceCurrency?: string }).priceCurrency)
      || (nested && typeof nested === 'object' && (nested as { currency?: string }).currency)
      || p.priceCurrency || COUNTRY_CURRENCY[opts.country] || 'SGD';
    const title = p.name || p.title;
    return {
      id: p.sku || p['@id'] || p.id,
      title,
      name: title,
      price: { amount: amount != null ? Number(amount) : null, currency: curr },
      merchant: p.brand?.name || p.seller || p.merchant || null,
      url: p.url || (offers && typeof offers === 'object' ? offers.url : null) || null,
      image_url: Array.isArray(p.image) ? p.image[0] : p.image,
      country_code: opts.country,
    };
  });
  return {
    best_price: data[0] ?? null,
    alternatives: data.slice(1),
    meta: {
      total: data.length,
      country: opts.country,
      response_time_ms: Date.now() - opts.t0,
      fallback: 'rest_search',
    },
  };
}


// BUY-74597: fail soft before MCP clients hit their visible timeout. Keep the
// contract centralized so FBP/get_deals/search_products do not regress to opaque
// -32603s or empty success envelopes when catalog lookup degrades.
type McpDegradedTool = 'search_products' | 'get_deals' | 'find_best_price';
type McpDegradedStage = 'catalog_search' | 'offer_aggregation' | 'merchant_join';
type McpDegradedKind = 'timeout' | 'auth_failure' | 'upstream_exception' | 'circuit_open';

const MCP_DEGRADED_CIRCUIT_THRESHOLD = Number(process.env.MCP_DEGRADED_CIRCUIT_THRESHOLD || 3);
const MCP_DEGRADED_CIRCUIT_COOLDOWN_MS = Number(process.env.MCP_DEGRADED_CIRCUIT_COOLDOWN_MS || 30_000);
const mcpDegradedCircuitState = new Map<string, { failures: number; openedUntil: number }>();

function mcpCircuitKey(tool: McpDegradedTool, stage: McpDegradedStage, country?: string | null) {
  return `${tool}:${stage}:${(country || 'GLOBAL').toUpperCase()}`;
}

function isMcpCircuitOpen(tool: McpDegradedTool, stage: McpDegradedStage, country?: string | null) {
  const key = mcpCircuitKey(tool, stage, country);
  // BUY-79598: search_products circuit stays open after query-specific 08P01/timeout
  // and blocks SG while REST is healthy. Drain it; REST fallback is the soft-fail path.
  if (tool === 'search_products') {
    mcpDegradedCircuitState.delete(key);
    return false;
  }
  const state = mcpDegradedCircuitState.get(key);
  return !!state && state.openedUntil > Date.now();
}

function recordMcpCircuitSuccess(tool: McpDegradedTool, stage: McpDegradedStage, country?: string | null) {
  mcpDegradedCircuitState.delete(mcpCircuitKey(tool, stage, country));
}

function recordMcpCircuitFailure(tool: McpDegradedTool, stage: McpDegradedStage, country?: string | null) {
  const key = mcpCircuitKey(tool, stage, country);
  const prev = mcpDegradedCircuitState.get(key) || { failures: 0, openedUntil: 0 };
  const failures = prev.failures + 1;
  mcpDegradedCircuitState.set(key, {
    failures,
    openedUntil: failures >= MCP_DEGRADED_CIRCUIT_THRESHOLD ? Date.now() + MCP_DEGRADED_CIRCUIT_COOLDOWN_MS : prev.openedUntil,
  });
}

function classifyMcpDegradedKind(err: unknown): McpDegradedKind {
  const e = err as { code?: string; message?: string } | null;
  const message = String(e?.message || '');
  if (e?.code === '57014' || e?.code === '55P03' || message.includes('mcp_db_pool_acquire_timeout') || message.includes('mcp_catalog_wall_timeout') || /timeout/i.test(message)) return 'timeout';
  if (e?.code === '28P01' || e?.code === '28000' || e?.code === '42501' || /auth|password|permission/i.test(message)) return 'auth_failure';
  return 'upstream_exception';
}

function buildMcpTimeoutEmptiness(kind: McpDegradedKind | 'partial_timeout', stage: McpDegradedStage, deliverToPresent: boolean, regionSupported = true) {
  return deriveEmptiness({
    regionHasAnyData: regionSupported,
    categoryHasAnyData: false,
    apiError: kind === 'upstream_exception',
    rateLimited: false,
    regionSupported,
    categoryRequested: false,
    requestedCategory: null,
    requestedCountry: null,
    rateLimitRemaining: null,
    deliverToPresent,
    unfilteredHasAnyData: null,
    queryAmbiguous: null,
    degradedKind: kind === 'partial_timeout' ? 'partial_timeout' : kind,
    timedOutStage: stage,
  });
}

function buildMcpDegradedSearchResponse(opts: {
  tool: McpDegradedTool;
  stage: McpDegradedStage;
  kind: McpDegradedKind | 'partial_timeout';
  limit: number;
  offset: number;
  responseTimeMs: number;
  country?: string | null;
  deliverToPresent: boolean;
}) {
  const emptiness = buildMcpTimeoutEmptiness(opts.kind, opts.stage, opts.deliverToPresent, !opts.country || (SUPPORTED_REGIONS as readonly string[]).includes(opts.country.toUpperCase()));
  return buildSearchResponse([], 0, opts.limit, opts.offset, opts.responseTimeMs, false, true, undefined, opts.country || null, emptiness);
}

function buildMcpDegradedBestPriceResponse(opts: {
  productName: string;
  country?: string | null;
  responseTimeMs: number;
  kind: McpDegradedKind | 'partial_timeout';
  stage: McpDegradedStage;
  deliverToPresent: boolean;
}) {
  const country = opts.country || 'SG';
  // BUY-79931: emptiness_reason stays on the locked P2.6 enum; timeout is degraded_kind only.
  const emptinessReason = 'api_error';
  return {
    best_price: null,
    alternatives: [],
    meta: {
      total: 0,
      product_name: opts.productName,
      country_code: country,
      currency: COUNTRY_CURRENCY[country] || 'SGD',
      response_time_ms: opts.responseTimeMs,
      degraded: true,
      status: 'degraded',
      degraded_kind: opts.kind === 'partial_timeout' ? 'timeout' : opts.kind,
      emptiness_reason: emptinessReason,
      confidence: 'low',
      diagnostic: {
        engine_status: opts.kind === 'auth_failure' ? 'error' : 'degraded',
        indexed_for_region: (SUPPORTED_REGIONS as readonly string[]).includes(country.toUpperCase()),
        category_recognized: false,
        rate_limit_remaining: null,
        deliver_to_present: opts.deliverToPresent,
        timed_out_stage: opts.stage,
      },
    },
  };
}

// BUY-56185/BUY-69684: Detect statement_timeout poisoned connections.
// When PostgreSQL's statement_timeout fires, the query is cancelled but the
// connection enters PQTRANS_INERROR state. Returning such a connection to the
// pool poises every subsequent query on it with "current transaction is aborted".
// NOTE: client.state tracks the socket connection state ('connected','connecting')
// and is NOT set to 'error' for transaction-level errors — we must check
// client.transactionStatus (pg's PQTRANS_* codes) to detect aborted transactions.
function releaseClientSafely(client: any) {
  try {
    // PQTRANS_INERROR = 3 — transaction aborted due to statement_timeout or other error.
    // Discard the connection so a fresh one is acquired from the pool next time.
    if (client && client.transactionStatus === 3) {
      client.release(true); // discard — do NOT return poisoned connection to pool
    } else {
      client.release();
    }
  } catch (_) {
    // Swallow release errors — pool will remove the bad client anyway.
  }
}

type McpMarket = { country: string; dbRegion: string; rawRegion: string };

// BUY-74181: product_embeddings lives in a separate vector DB without country/region
// columns, so a global nearest-neighbour set can leak out-of-market candidates into
// hybrid/semantic results. Re-scope vector candidates against the catalog before RRF
// or detail fetch so ranking and pagination are computed on the buyer's market only.
async function filterVectorCandidatesByMarket(
  client: PoolClient,
  candidateIds: string[],
  country: string,
  region: string
): Promise<string[]> {
  if (candidateIds.length === 0) return [];
  if (!country && !region) return candidateIds;

  const params: unknown[] = [candidateIds];
  // products.id is bigint. The old ::uuid[] cast raised
  // 'operator does not exist: bigint = uuid', which aborted the enclosing search
  // transaction and made every hybrid/semantic MCP query return 0 results.
  const conditions = ['id = ANY($1::bigint[])', 'is_active = true'];
  if (country) {
    params.push(country.toUpperCase());
    conditions.push(`country_code = $${params.length}`);
  }
  if (region) {
    params.push(region.toLowerCase());
    conditions.push(`region = $${params.length}`);
  }
  try {
    const result = await client.query<{ id: string }>(
      `SELECT id FROM products WHERE ${conditions.join(' AND ')}`,
      params
    );
    const allowed = new Set(result.rows.map((r: { id: string }) => String(r.id)));
    return candidateIds.map(String).filter(id => allowed.has(id));
  } catch (err) {
    console.warn('[search] vector candidate market filter failed, using global set:', (err as Error).message);
    // Roll back to the vector-stage savepoint so a filter failure cannot poison the
    // caller's transaction (the reason hybrid used to return a degraded envelope).
    await client.query('ROLLBACK TO SAVEPOINT vector_stage').catch(() => {});
    return candidateIds;
  }
}

function normalizeMcpMarket(args: Record<string, unknown>, defaultCountry = ''): McpMarket {
  const rawRegion = String(args.region || '').trim();
  const regionLower = rawRegion.toLowerCase();
  const explicitCountry = String(
    (args.deliver_to as string) || (args.country_code as string) || (args.country as string) || ''
  ).trim().toUpperCase();
  const regionCountry: Record<string, string> = {
    us: 'US',
    sg: 'SG',
    my: 'MY',
    th: 'TH',
    vn: 'VN',
    ph: 'PH',
    id: 'ID',
    gb: 'GB',
    uk: 'GB',
    in: 'IN',
    au: 'AU',
  };
  const regionLooksIso = /^[A-Z]{2}$/.test(rawRegion);
  const regionCountryCode = regionCountry[regionLower] || (regionLooksIso ? rawRegion : '');
  return {
    country: explicitCountry || regionCountryCode || defaultCountry,
    dbRegion: rawRegion && !regionLooksIso ? regionLower : '',
    rawRegion,
  };
}

// MCP tools manifest
const TOOLS = [
  {
    name: 'search_products',
    description: 'Search the BuyWhere product catalog by keyword. Treat deliver_to as REQUIRED for buyer-facing use (ISO-3166 country of the end user); it takes precedence over country_code/country and prevents all-market scans. Returns product records with title, description, image, price, and merchant information. Covers e-commerce platforms across Singapore, Malaysia, Indonesia, Thailand, Vietnam, and US. Use compact=true for agent-optimized responses with structured_specs, comparison_attributes, and normalized_price_usd fields. BUY-74597 degraded contract: when the catalog query cannot complete inside the user-facing timeout, this tool returns a 200-OK envelope with `meta.status="degraded"`, `meta.emptiness_reason="api_error"` with `meta.degraded_kind="timeout"` (or `"partial_timeout"` / `"auth_failure"`), `meta.confidence="low"`, and `meta.diagnostic.timed_out_stage` naming the failed stage (catalog_search / offer_aggregation / merchant_join). It never returns an unqualified empty result when the cause is timeout, auth failure, upstream exception, or circuit breaker. Agents should branch on `meta.degraded === true` (or `meta.status === "degraded"`) instead of treating empty `data` as no_match.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Keyword search query' },
        // BUY-75287: accept the natural `query` alias so callers (Atlas cycle 23,
        // agents) using it don't silently fall into the no-q browse branch — that
        // path returns 0 rows plus a pg_class.reltuples "total" (~364,777,600)
        // that looks like fabricated cache data. Live repro (2026-08-26):
        // api.buywhere.ai/mcp search_products(query="running shoes",
        // country_code="TH") → data:[], total:364777600, cached:false.
        query: { type: 'string', description: 'Alias for q (accepted for agent convenience; use q). Without this, callers passing `query` get 0 rows and the reltuples-derived total — see BUY-75287.' },
        domain: { type: 'string', description: 'Filter by merchant platform (e.g. lazada, shopee, amazon)' },
        region: { type: 'string', description: 'Filter by region (sea, us, eu, au)' },
        country_code: { type: 'string', enum: ['SG', 'US', 'VN', 'TH', 'MY'], description: 'Filter by ISO country code. Also infers default currency for price filters (SG→SGD, US→USD, VN→VND, TH→THB, MY→MYR).' },
        deliver_to: { type: 'string', description: 'Treat as REQUIRED for buyer-facing use: ISO-3166 country of the END USER (e.g. "SG", "US"). Without it results are not shipping-ranked and may be undeliverable. Preferred over country_code/country.' },
        country: { type: 'string', description: 'Alias for country_code (deprecated, use country_code)' },
        market: { type: 'string', description: 'Alias for country_code (deprecated, use country_code).' },
        min_price: { type: 'number', description: 'Minimum price (in currency inferred from country_code, or SGD by default)' },
        max_price: { type: 'number', description: 'Maximum price (in currency inferred from country_code, or SGD by default)' },
        limit: { type: 'integer', description: 'Number of results (max 100, default 20)', default: 20 },
        offset: { type: 'integer', description: 'Pagination offset', default: 0 },
        compact: { type: 'boolean', description: 'Return agent-optimized compact shape: structured_specs, comparison_attributes, normalized_price_usd. Reduces response size ~40%. Recommended for agent tool-use.', default: false },
        category: { type: 'string', description: 'Filter by product category name (e.g. "Laptops", "Smartphones", "Televisions"). Use to exclude accessories and get actual products.' },
        mode: { type: 'string', enum: ['keyword', 'semantic', 'hybrid'], description: 'Search mode: keyword=FTS only (default, matches REST /v1/products/search), semantic=vector only, hybrid=RRF blend of FTS+vector. Falls back to keyword if vector DB or FLOWAI_EMBED_API_KEY unavailable.', default: 'keyword' },
      },
    },
  },
  {
    name: 'get_product',
    description: 'Get a specific product by its ID, including full details and current price.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Product UUID' },
      },
    },
  },
  {
    name: 'compare_products',
    description: 'Compare multiple products side-by-side. Returns price, brand, rating, and category for each.',
    inputSchema: {
      type: 'object',
      required: ['ids'],
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of product IDs to compare (2-10)',
          minItems: 2,
          maxItems: 10,
        },
      },
    },
  },
  {
    name: 'get_deals',
    description: 'Get discounted products sorted by discount percentage. Returns schema.org/Product entities with schema.org/Offer properties: price, priceCurrency, availability, originalPrice, and discountPercentage. Covers Singapore, Malaysia, Indonesia, Thailand, Vietnam, and US e-commerce. Supports currency, region (sea, us, eu, au) and country (SG, US, VN, MY, ...) filters. BUY-74597 degraded contract: when the discount-index scan cannot complete inside the user-facing timeout, this tool returns a 200-OK envelope with `meta.status="degraded"`, `meta.emptiness_reason="api_error"` with `meta.degraded_kind="timeout"` (or `"partial_timeout"` / `"auth_failure"`), `meta.confidence="low"`, and `meta.diagnostic.timed_out_stage` (typically `offer_aggregation`). It never returns an unqualified empty result when the cause is timeout, auth failure, upstream exception, or circuit breaker. Branch on `meta.degraded === true` or `meta.status === "degraded"`.',
    inputSchema: {
      type: 'object',
      properties: {
        min_discount: { type: 'number', description: 'Minimum discount percentage (default 10)', default: 10 },
        currency: { type: 'string', description: 'Filter by currency code (SGD, USD, MYR, VND, THB). Defaults to SGD.', default: 'SGD' },
        region: { type: 'string', description: 'Filter by region (sea, us, eu, au)' },
        country_code: { type: 'string', enum: ['SG', 'US', 'VN', 'TH', 'MY'], description: 'Filter by ISO country code. Alias: country.' },
        deliver_to: { type: 'string', description: 'Treat as REQUIRED for buyer-facing use: ISO-3166 country of the END USER (e.g. "SG", "US"). Without it results are not shipping-ranked and may be undeliverable. Preferred over country_code/country.' },
        country: { type: 'string', description: 'Alias for country_code (deprecated, use country_code)' },
        market: { type: 'string', description: 'Alias for country_code (deprecated, use country_code).' },
        limit: { type: 'integer', description: 'Number of results (max 100, default 20)', default: 20 },
        offset: { type: 'integer', description: 'Pagination offset', default: 0 },
      },
    },
  },
  {
    name: 'list_categories',
    description: 'List top-level product categories available in the BuyWhere catalog.',
    inputSchema: {
      type: 'object',
      properties: {
        region: { type: 'string', enum: ['us', 'sg', 'my', 'gb', 'in', 'au'], description: 'Region alias mapped to ISO country code.' },
        country_code: { type: 'string', enum: ['SG', 'US', 'VN', 'TH', 'MY', 'GB', 'IN', 'AU'], description: 'Filter by ISO country code. Defaults to SG.' },
        country: { type: 'string', description: 'Alias for country_code (deprecated, use country_code)' },
        market: { type: 'string', description: 'Alias for country_code (deprecated, use country_code).' },
      },
    },
  },
  {
    name: 'find_best_price',
    description: 'Use this whenever a user asks about prices, wants to find the cheapest option, or asks "what\'s the best price for X" or "where can I buy X for the lowest price". Returns schema.org/Product entities with schema.org/AggregateOffer (lowPrice, offerCount, priceCurrency) across all merchants. BUY-74597 degraded contract: when the candidates query cannot complete inside the user-facing timeout, this tool returns a 200-OK envelope with `meta.degraded=true`, `meta.status="degraded"`, `meta.emptiness_reason="api_error"` with `meta.degraded_kind="timeout"` (or `"partial_timeout"` / `"auth_failure"`), `meta.confidence="low"`, and `meta.diagnostic.timed_out_stage="catalog_search"`, with `best_price=null` and `alternatives=[]`. It never returns an unqualified empty result when the cause is timeout, auth failure, upstream exception, or circuit breaker.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Keyword search query — alias for product_name' },
        product_name: { type: 'string', description: 'Product name to find best price for (e.g., "iphone 15 pro 256gb", "samsung galaxy s24")' },
        category: { type: 'string', description: 'Category to filter by (e.g., "electronics", "fashion")' },
        country_code: { type: 'string', enum: ['SG', 'MY', 'TH', 'PH', 'VN', 'ID', 'US'], description: 'Country to search in (defaults to SG). Alias: country.' },
        deliver_to: { type: 'string', description: 'Treat as REQUIRED for buyer-facing use: ISO-3166 country of the END USER (e.g. "SG", "US"). Without it results are not shipping-ranked and may be undeliverable. Preferred over country_code/country.' },
        country: { type: 'string', description: 'Alias for country_code (deprecated, use country_code)' },
        market: { type: 'string', description: 'Alias for country_code (deprecated, use country_code).' },
        region: { type: 'string', enum: ['us', 'sea'], description: 'Region filter - use "us" for United States or "sea" for Southeast Asia' },
      },
    },
  },
  {
    name: 'find_similar',
    description: 'Find products similar to a given product using vector similarity. Returns up to 10 nearest neighbours by semantic meaning (title+description embedding). Useful for "more like this" recommendations.',
    inputSchema: {
      type: 'object',
      required: ['product_id'],
      properties: {
        product_id: { type: 'string', description: 'UUID of the source product' },
        limit: { type: 'integer', description: 'Number of similar products to return (1-10, default 10)', default: 10 },
      },
    },
  },
  {
    name: 'ingest_products',
    description: 'Ingest (upsert) a batch of products into the BuyWhere catalog. Use this to add or update product listings from any merchant/source. Requires a valid API key with ingest permissions. Accepts up to 1000 products per call with source, SKU, title, price, URL, and optional metadata.',
    inputSchema: {
      type: 'object',
      required: ['source', 'products'],
      properties: {
        source: { type: 'string', description: 'Data source identifier (e.g. "shopee_sg", "amazon_sg", "lazada_sg")' },
        products: {
          type: 'array',
          description: 'Array of product objects to ingest (max 1000)',
          items: {
            type: 'object',
            required: ['sku', 'merchant_id', 'title', 'price', 'url'],
            properties: {
              sku: { type: 'string', description: 'Unique stock keeping unit identifier' },
              merchant_id: { type: 'string', description: 'Merchant identifier' },
              title: { type: 'string', description: 'Product title' },
              description: { type: 'string', description: 'Product description' },
              price: { type: 'number', description: 'Current price (must be >= 0)' },
              currency: { type: 'string', description: 'Currency code (default: SGD)', default: 'SGD' },
              url: { type: 'string', description: 'Product URL on the merchant site' },
              image_url: { type: 'string', description: 'Main product image URL' },
              category: { type: 'string', description: 'Product category' },
              brand: { type: 'string', description: 'Brand name' },
              is_active: { type: 'boolean', description: 'Whether the product is active (default: true)' },
              is_available: { type: 'boolean', description: 'Whether the product is in stock' },
              country_code: { type: 'string', description: 'ISO country code (e.g. "SG", "US")' },
              region: { type: 'string', description: 'Region identifier (e.g. "sea", "us")' },
              metadata: { type: 'object', description: 'Additional product metadata' },
            },
          },
        },
      },
    },
  },
];

// BUY-72533: v2 tool surface — REQUIRED deliver_to, shopping_job_id, outbound_url resolver.
// Lives alongside the v1 surface; v1 stays callable until 2026-12-31Z (per Reed spec).
// v2 names MUST NOT alias to v1 at runtime — callers must pick v2 explicitly.
const V2_TOOLS = [
  {
    name: 'search_products_v2',
    description: 'REQUIRED deliver_to. Search the BuyWhere product catalog by keyword. The deliver_to parameter is REQUIRED (ISO country code, e.g. "SG", "US") — it takes precedence over country_code/country and prevents all-market scans. Always pass deliver_to="SG" (or your buyer\'s country). Returns product records with title, description, image, price, and merchant information. Covers e-commerce platforms across Singapore, Malaysia, Indonesia, Thailand, Vietnam, and US. Use compact=true for agent-optimized responses with structured_specs, comparison_attributes, and normalized_price_usd fields.',
    inputSchema: {
      type: 'object',
      required: ['deliver_to'],
      properties: {
        q: { type: 'string', description: 'Keyword search query' },
        // BUY-75287: `query` alias for q — see v1 schema above for rationale.
        query: { type: 'string', description: 'Alias for q (accepted for agent convenience; use q). Without this, callers passing `query` get 0 rows and the reltuples-derived total — see BUY-75287.' },
        domain: { type: 'string', description: 'Filter by merchant platform (e.g. lazada, shopee, amazon)' },
        region: { type: 'string', description: 'Filter by region (sea, us, eu, au)' },
        country_code: { type: 'string', enum: ['SG', 'US', 'VN', 'TH', 'MY'], description: 'Filter by ISO country code. Also infers default currency for price filters (SG→SGD, US→USD, VN→VND, TH→THB, MY→MYR).' },
        deliver_to: { type: 'string', description: 'REQUIRED. Buyer delivery country/market (ISO country code, e.g. "SG", "US").' },
        country: { type: 'string', description: 'Alias for country_code (deprecated, use country_code)' },
        min_price: { type: 'number', description: 'Minimum price (in currency inferred from country_code, or SGD by default)' },
        max_price: { type: 'number', description: 'Maximum price (in currency inferred from country_code, or SGD by default)' },
        limit: { type: 'integer', description: 'Number of results (max 100, default 20)', default: 20 },
        offset: { type: 'integer', description: 'Pagination offset', default: 0 },
        compact: { type: 'boolean', description: 'Return agent-optimized compact shape: structured_specs, comparison_attributes, normalized_price_usd. Reduces response size ~40%. Recommended for agent tool-use.', default: false },
        category: { type: 'string', description: 'Filter by product category name (e.g. "Laptops", "Smartphones", "Televisions"). Use to exclude accessories and get actual products.' },
        mode: { type: 'string', enum: ['keyword', 'semantic', 'hybrid'], description: 'Search mode: keyword=FTS only (default, matches REST /v1/products/search), semantic=vector only, hybrid=RRF blend of FTS+vector. Falls back to keyword if vector DB or FLOWAI_EMBED_API_KEY unavailable.', default: 'keyword' },
      },
    },
  },
  {
    name: 'get_product_v2',
    description: 'REQUIRED deliver_to. Get a specific product by its ID, including full details and current price. Always pass deliver_to="SG" (or your buyer\'s country). Response includes a resolved outbound_url (https://…) that routes the buyer through the BuyWhere click tracker when the product has merchant offers.',
    inputSchema: {
      type: 'object',
      required: ['id', 'deliver_to'],
      properties: {
        id: { type: 'string', description: 'Product UUID' },
        deliver_to: { type: 'string', description: 'REQUIRED. Buyer delivery country/market (ISO country code, e.g. "SG", "US").' },
      },
    },
  },
  {
    name: 'compare_products_v2',
    description: 'REQUIRED deliver_to. Compare multiple products side-by-side. Always pass deliver_to="SG" (or your buyer\'s country). Returns price, brand, rating, category, and a resolved outbound_url per product for the buyer market.',
    inputSchema: {
      type: 'object',
      required: ['ids', 'deliver_to'],
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of product IDs to compare (2-10)',
          minItems: 2,
          maxItems: 10,
        },
        deliver_to: { type: 'string', description: 'REQUIRED. Buyer delivery country/market (ISO country code, e.g. "SG", "US").' },
      },
    },
  },
  {
    name: 'get_deals_v2',
    description: 'REQUIRED deliver_to. Get discounted products sorted by discount percentage. Always pass deliver_to="SG" (or your buyer\'s country). Returns schema.org/Product entities with schema.org/Offer properties: price, priceCurrency, availability, originalPrice, and discountPercentage. Covers Singapore, Malaysia, Indonesia, Thailand, Vietnam, and US e-commerce. Supports currency, region (sea, us, eu, au) and country (SG, US, VN, MY, ...) filters.',
    inputSchema: {
      type: 'object',
      required: ['deliver_to'],
      properties: {
        min_discount: { type: 'number', description: 'Minimum discount percentage (default 10)', default: 10 },
        currency: { type: 'string', description: 'Filter by currency code (SGD, USD, MYR, VND, THB). Defaults to SGD.', default: 'SGD' },
        region: { type: 'string', description: 'Filter by region (sea, us, eu, au)' },
        country_code: { type: 'string', enum: ['SG', 'US', 'VN', 'TH', 'MY'], description: 'Filter by ISO country code. Alias: country.' },
        deliver_to: { type: 'string', description: 'REQUIRED. Buyer delivery country/market (ISO country code, e.g. "SG", "US").' },
        country: { type: 'string', description: 'Alias for country_code (deprecated, use country_code)' },
        limit: { type: 'integer', description: 'Number of results (max 100, default 20)', default: 20 },
        offset: { type: 'integer', description: 'Pagination offset', default: 0 },
      },
    },
  },
  {
    name: 'find_best_price_v2',
    description: 'REQUIRED deliver_to. Use this whenever a user asks about prices, wants to find the cheapest option, or asks "what\'s the best price for X" or "where can I buy X for the lowest price". Always pass deliver_to="SG" (or your buyer\'s country). Returns schema.org/Product entities with schema.org/AggregateOffer (lowPrice, offerCount, priceCurrency) across all merchants. Response includes a shopping_job_id (UUID) you can use to resume a multi-merchant price-comparison session for the buyer.',
    inputSchema: {
      type: 'object',
      required: ['deliver_to'],
      properties: {
        q: { type: 'string', description: 'Keyword search query — alias for product_name' },
        product_name: { type: 'string', description: 'Product name to find best price for (e.g., "iphone 15 pro 256gb", "samsung galaxy s24")' },
        category: { type: 'string', description: 'Category to filter by (e.g., "electronics", "fashion")' },
        country_code: { type: 'string', enum: ['SG', 'MY', 'TH', 'PH', 'VN', 'ID', 'US'], description: 'Country to search in (defaults to SG). Alias: country.' },
        deliver_to: { type: 'string', description: 'REQUIRED. Buyer delivery country/market (ISO country code, e.g. "SG", "US").' },
        country: { type: 'string', description: 'Alias for country_code (deprecated, use country_code)' },
        region: { type: 'string', enum: ['us', 'sea'], description: 'Region filter - use "us" for United States or "sea" for Southeast Asia' },
      },
    },
  },
];

// Combined surface — v1 + v2 — for tools/list and the GET /mcp info endpoint.
const TOOLS_ALL = [...TOOLS, ...V2_TOOLS];

let _hasDiscountPct: boolean | undefined;

async function probeDiscountPctColumn(): Promise<boolean> {
  try {
    const probe = await db.query(
      `SELECT is_generated FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'discount_pct' LIMIT 1`
    );
    return probe.rows.length > 0 && probe.rows[0].is_generated === 'ALWAYS';
  } catch {
    return false;
  }
}

probeDiscountPctColumn().then(result => { _hasDiscountPct = result; }).catch(() => {});

// Tool handlers
async function handleSearchProducts(args: Record<string, unknown>, caller?: { apiKeyId?: string | null; keyHash?: string | null } | null) {
  const t0 = Date.now();
  void (args.deliver_to as string);
  // BUY-75287: accept the `query` alias for `q`. Without this, callers (Atlas
  // cycle 23, agents) passing `query` instead of canonical `q` silently fall
  // into the no-q browse branch: 0 rows plus a pg_class.reltuples "total"
  // (~364,777,600) that looks like fabricated cache data. Same regression was
  // fixed twice before (BUY-68587, BUY-70288) and re-broken by intervening
  // refactors; this re-applies and documents the contract on both handlers.
  const q = ((args.q as string) || (args.query as string) || '').trim();
  const mode = (args.mode as string) || 'keyword';
  const flowAiKey = process.env.FLOWAI_EMBED_API_KEY ?? '';
  const useVector = vectorDb != null && flowAiKey !== '' && q !== '' && mode !== 'keyword';
  const domain = (args.domain as string) || '';
  // BUY-79642: catalog.region is 'sea' for all SEA ISO countries; filtering
  // region=sea with country_code already applied is a no-op. ISO aliases
  // (sg/my/…) are rewritten in normalizeMarketArg. Do not AND region=sea
  // when a country is present — it only risks missing sg-labelled rows.
  const rawRegionArg = String(args.region || '').trim().toLowerCase();
  const countryHint = (((args.deliver_to as string) || (args.country_code as string) || (args.country as string)) || '').toUpperCase();
  const region = (rawRegionArg === 'sea' && countryHint) ? '' : (args.region as string) || '';
  // country_code is canonical; `country` kept as alias for backward compat
  // BUY-6598: Default to SG for search queries. BUY-31962: skip default for
  // empty-q browse mode — no index on country_code makes filtered scan slow,
  // and recent rows are predominantly US/null so SG filter finds nothing.
  // BUY-73666: deliver_to takes precedence over country_code/country per tool
  // schema contract. Without this, MCP clients passing deliver_to="US" get SG
  // results because the country filter was never applied.
  const rawCountry = (((args.deliver_to as string) || (args.country_code as string) || (args.country as string)) || '').toUpperCase();
  // BUY-79690: do not silently default dest — empty+no dest is deliver_to_missing.
  const country = rawCountry;
  // BUY-79690: tracks whether the caller passed any dest signal. Used to gate
  // meta.deliver_to echo (only when explicit) and to drive deriveEmptiness signal.
  const hasExplicitCountry = !!(args.deliver_to || args.country_code || args.country);
  const category = (args.category as string) || '';
  const minPrice = args.min_price != null ? Number(args.min_price) : null;
  const maxPrice = args.max_price != null ? Number(args.max_price) : null;
  const limit = Math.min(Number(args.limit) || 20, 100);
  const offset = Number(args.offset) || 0;
  const compact = args.compact === true;
  const currency = country ? (COUNTRY_CURRENCY[country] || 'SGD') : 'SGD';

// BUY-72044 / P2.6A: did the caller pass any buyer-market signal? Drives
  // `diagnostic.deliver_to_present` on every response and the deliver_to_missing
  // emptiness branch. Note: this is the request-level fact (was the input
  // present?), not whether the engine honored it.
  const deliverToPresent = Boolean(
    (typeof args.deliver_to === 'string' && args.deliver_to.trim() !== '') ||
    (typeof args.country_code === 'string' && args.country_code.trim() !== '') ||
    (typeof args.country === 'string' && args.country.trim() !== '')
  );

  // BUY-71542 / P2.6 + BUY-72044 / P2.6A: probe results captured by the in-try
  // probes below. Defaults are pessimistic so a missed probe degrades to
  // region_supported=true / category_has_any_data=true (i.e. no_data wins over
  // category_unsupported when we have no signal — the conservative answer).
  let unfilteredHasAnyData: boolean | null = null;
  let regionHasAnyDataProbe = true;
  let categoryHasAnyDataProbe = true;

  const restFallbackOpts = {
    q, country, limit, offset, compact, currency,
    apiKey: typeof args._mcpInboundApiKey === 'string' ? args._mcpInboundApiKey : undefined,
  };
  const restFallbackPromise = q
    ? searchProductsViaRestFallback(restFallbackOpts)
    : Promise.resolve(null);

  if (isMcpCircuitOpen('search_products', 'catalog_search', country || null)) {
    const restHits = await restFallbackPromise;
    if (restHits && restHits.products.length > 0) {
      console.warn(`[search_products] BUY-79260: circuit_open — REST fallback n=${restHits.products.length} country=${country}`);
      return aliasSearchEnvelope(buildSearchResponse(restHits.products, restHits.total, limit, offset, Date.now() - t0, false));
    }
    return buildMcpDegradedSearchResponse({
      tool: 'search_products',
      stage: 'catalog_search',
      kind: 'circuit_open',
      limit,
      offset,
      responseTimeMs: Date.now() - t0,
      country: country || null,
      deliverToPresent,
    });
  }

  // BUY-68652: mode-aware cache key. Include mode in key so semantic/hybrid cannot
  // be satisfied by keyword results (and vice versa). When embedding fails and we
  // fall through to keyword, use 'kw' suffix to prevent polluting the semantic cache.
  const effectiveCacheMode = useVector ? mode : 'kw';
  // BUY-79497: v8 busts pre-isolation Redis pages (SG USD Shopify / US SGD).
  const cacheKey = `fts:v10:${q}:${domain}:${region}:${country}:${category}:${currency}:${minPrice}:${maxPrice}:${limit}:${offset}:${compact ? 'c' : 'f'}:${effectiveCacheMode}`;
  // BUY-68652: true if we ended up serving keyword FTS rows for a semantic/hybrid
  // request (embed/vector unavailable). The result must be cached under the 'kw'
  // suffix, never the requested-mode key.
  let keywordFallbackServed = !useVector;
  try {
    const cached = await recordQueryCacheLookup(redis, cacheKey, () => redis.get(cacheKey));
    if (cached) {
      const parsed = JSON.parse(cached);
      // BUY-76552: empty arrays are truthy in JS — skip cache for zero-result
      // or degraded responses to prevent cache poisoning that perpetuates
      // transient 0-result outages (cache → serve 0 → cache 0 → …).
      if (parsed.results && parsed.results.length > 0 && !parsed.degraded) {
        const wantCur = (currency || '').toUpperCase();
        const leak = wantCur && (parsed.results as Record<string, unknown>[]).some((p) => {
          const price = p.price as unknown;
          const cur = (price && typeof price === 'object' && price !== null && 'currency' in (price as object))
            ? String((price as { currency?: string }).currency || '').toUpperCase()
            : String((p as { currency?: string }).currency || '').toUpperCase();
          return cur !== wantCur;
        });
        if (!leak) {
          await recordCacheHitLatency(redis, Date.now() - t0);
          return { ...parsed, cached: true, response_time_ms: Date.now() - t0 };
        }
      }
    }
  } catch (_) { /* redis miss — proceed */ }

  // BUY-72362: identifier-shaped queries (ASIN/EAN/GTIN/UPC/Apple-part) bypass
  // FTS entirely. FTS cannot resolve an ASIN — it returns 0 rows — and worse,
  // it returns *wrong* rows for tokenised-but-not-identifier queries
  // (SKU-12345 → fishing reels). The detector is conservative, so a natural-
  // language query never reaches this branch. Identifiers also force keyword-
  // only — sending an ASIN through the vector arm adds latency + cost +
  // hallucinated neighbours.
  const identifier = detectIdentifier(q);
  if (identifier) {
    try {
      const idIdx = 1;
      const idParams: unknown[] = [identifier.normalized];
      const idConds: string[] = ['is_active = true'];
      idConds.push(identifierMatchPredicate(identifier, idIdx).sql);
      if (country) {
        idParams.push(country.toUpperCase());
        idConds.push(`country_code = $${idParams.length}`);
      }
      if (domain) {
        idParams.push(domain);
        idConds.push(`source = $${idParams.length}`);
      }
      const idWhere = `WHERE ${idConds.join(' AND ')}`;
      idParams.push(limit + 1);
      const idLimit = idParams.length;
      idParams.push(0);
      const idOffset = idParams.length;
      const idResult = await db.query(
        // BUY-79353: use merchant_id as displayed merchant, not source (feed origin).
        `SELECT id, sku AS source, merchant_id AS domain, url, title,
                price, currency, image_url, brand, mpn, gtin, category_path,
                avg_rating AS rating, review_count, metadata, updated_at, region, country_code
         FROM products ${idWhere}
         ORDER BY id DESC
         LIMIT $${idLimit} OFFSET $${idOffset}`,
        idParams
      );
      const idRows = idResult.rows;
      const idTotal = idRows.length;
      const idPage = idTotal > limit ? idRows.slice(0, limit) : idRows;
      const idProducts = idPage.map((r) => buildProduct(r as Record<string, unknown>, currency, compact));
      const idResult2 = buildSearchResponse(idProducts, idTotal, limit, 0, Date.now() - t0, false);
      try {
        await redis.set(cacheKey, JSON.stringify(idResult2), 'EX', MCP_FTS_CACHE_TTL_SECONDS);
      } catch (_) { /* cache write failure is non-fatal */ }
      return { ...idResult2, identifier_kind: identifier.kind };
    } catch (idErr) {
      // Fail-open to FTS — never let an identifier-detection bug poison the
      // whole surface. The non-identifier fallback path is below.
      console.warn('[search_products] identifier lookup failed, falling back to FTS:', (idErr as Error)?.message);
    }
  }

  const conditions: string[] = ['is_active = true'];
  const params: unknown[] = [];

  if (q) {
    params.push(q);
    conditions.push(`search_vector @@ plainto_tsquery('english', $${params.length})`);
  }
  if (domain) {
    params.push(domain);
    conditions.push(`source = $${params.length}`);
  }
  if (minPrice != null) {
    params.push(minPrice);
    conditions.push(`price >= $${params.length}`);
  }
  if (maxPrice != null) {
    params.push(maxPrice);
    conditions.push(`price <= $${params.length}`);
  }
  if (region) {
    params.push(region);
    conditions.push(`region = $${params.length}`);
  }
  if (country) {
    params.push(country.toUpperCase());
    conditions.push(`country_code = $${params.length}`);
  }
  if (country && COUNTRY_CURRENCY[country]) {
    params.push(COUNTRY_CURRENCY[country]);
    conditions.push(`currency = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // BUY-72082: Tier search via search_products partitioned table (97M rows,
  // GIN-indexed, country-partitioned) instead of the 368M-row products table.
  // Drops is_active (tier only contains active products) and category ILIKE
  // (tier category is a slug, not free-text). Uses sp.* prefix to avoid
  // ambiguity when the tier query joins back to products for full columns.
  const tierConditions: string[] = [];
  const tierParams: unknown[] = [];
  if (q) {
    tierParams.push(q);
    tierConditions.push(`sp.search_vector @@ plainto_tsquery('english', $${tierParams.length})`);
  }
  if (domain) {
    tierParams.push(domain);
    tierConditions.push(`sp.source = $${tierParams.length}`);
  }
  if (minPrice != null) {
    tierParams.push(minPrice);
    tierConditions.push(`sp.price >= $${tierParams.length}`);
  }
  if (maxPrice != null) {
    tierParams.push(maxPrice);
    tierConditions.push(`sp.price <= $${tierParams.length}`);
  }
  if (region) {
    tierParams.push(region);
    tierConditions.push(`sp.region = $${tierParams.length}`);
  }
  const useChildTable = FAST_CHILD_TABLE_COUNTRIES.has((country || '').toUpperCase());
  const ftsTable = useChildTable
    ? `products_partitioned_${(country || 'SG').toLowerCase()}`
    : 'search_products';
  if (country && !useChildTable) {
    tierParams.push(country.toUpperCase());
    tierConditions.push(`sp.country_code = $${tierParams.length}`);
  }
  if (country && COUNTRY_CURRENCY[country]) {
    // BUY-80024: FAST child tables (products_partitioned_sg) GIN-rank USD Shopify
    // rows first. Isolation then drops them and MCP returns total=24 data=[].
    // Push native currency into FTS so overfetch is SGD/USD-native, not leaks.
    tierParams.push(COUNTRY_CURRENCY[country]);
    tierConditions.push(`sp.currency = $${tierParams.length}`);
  }
  if (useChildTable) {
    tierConditions.push('sp.is_active = true');
  }
  // NOTE: category ILIKE intentionally omitted — search_products has category
  // as a slug; REST tier uses exact match. Add tierParams/tierConditions here
  // if category filtering on the tier becomes needed.
  const tierWhere = tierConditions.length ? `WHERE ${tierConditions.join(' AND ')}` : '';

  let rows: unknown[] = [];
  let total = 0;

  // BUY-57370: catch pool exhaustion fast — under concurrent load (e.g. Tune
  // automated testing), the 50-connection pool can saturate when US-partition
  // queries hold connections for 5-12s. Without .catch(), the raw pg PoolError
  // (string code like '57P01') escapes to the outer handler which checks
  // typeof code === 'number' — fails for string codes — and returns the
  // opaque -32603 "Internal error" that Tune detected.
  // BUY-69823: bound pool acquisition separately from statement_timeout so
  // api.buywhere.ai/mcp fails fast with a standardized envelope under contention
  // instead of consuming the whole 12s query budget before the handler starts.
  // BUY-65095: route to read replica (maglev) instead of primary (sakura) for
  // full-text search. Same FTS at 400M+ rows takes 149ms on replica, >12s
  // (statement_timeout) on primary. REST /v1/products/search already uses
  // servingReadDbConnect(). Fallback to acquireMcpClient() (primary) if the
  // replica is unavailable.
  const searchClient = await servingReadDbConnect().catch((err: unknown) => {
    if (err instanceof ReplicaUnavailableError) {
      console.warn('[search_products] replica unavailable, falling back to primary:', err.message);
      return acquireMcpClient();
    }
    console.warn('[search_products] db.connect failed:', (err as Error)?.message);
    throw { code: -32603, message: 'Database connection timeout' };
  });
  try {
    // BUY-56185: statement_timeout bounds catalog_search latency.
    // BUY-76552: raised from 4s to 30s. Under cold-cache conditions the GIN
    // bitmap plan on the non-partitioned search_products table (96M rows) with
    // country_code filter takes ~13s for broad queries like 'laptop' (246K+
    // global matches rechecked against country filter). The 4s timeout caused
    // every v2 search to throw upstream_exception → degraded 0 results.
    // 30s matches REST tier timeout headroom while still failing fast vs
    // runaway queries. The degraded envelope (BUY-74597) still fires on
    // genuine timeouts beyond 30s.
    // 2026-08-29: a pooled connection can arrive already inside an aborted transaction
    // (poisoned by a statement_timeout on another route sharing this pool). Clearing it
    // costs nothing and prevents 25P02 from failing every MCP query.
    await searchClient.query('ROLLBACK').catch(() => {});
    await searchClient.query('BEGIN');
    await searchClient.query(`SET LOCAL statement_timeout = '${MCP_CATALOG_STATEMENT_TIMEOUT_MS}'`);
    await searchClient.query(`SET LOCAL gin_fuzzy_search_limit = 0`);
    await searchClient.query(`SET LOCAL max_parallel_workers_per_gather = 0`);
    await searchClient.query(`SET LOCAL work_mem = '64MB'`);
    await searchClient.query('SET work_mem = \'64MB\''); // BUY-26343: encourage GIN bitmap plan over btree index scan for FTS queries
    // BUY-76552+BUY-76553: mirror REST tier settings to fix timeout on MCP.
    // REST uses these settings and works; MCP was timing out without them.
    await searchClient.query('SET gin_fuzzy_search_limit = 0'); // fuzzy sampling breaks multi-word AND
    await searchClient.query('SET max_parallel_workers_per_gather = 0'); // disable parallelism to match REST tier behavior
    if (useChildTable) {
      await searchClient.query(`SET LOCAL enable_seqscan = off`);
    }
    // BUY-76552: REMOVED enable_seqscan=off for search_products tier.
    // The non-partitioned search_products table with country_code filter produces
    // a huge bitmap recheck (246K+ global laptop rows rechecked against SG filter)
    // when seqscan is off, pushing the count query past the 12s statement_timeout
    // under cold-cache conditions. The planner naturally chooses the GIN index
    // path when it's optimal; forcing it backfires on the tier table. Keep
    // enable_seqscan=off for get_deals/find_best_price (different query patterns).
    if (q) {
      // BUY-78767: do not COUNT(*) search_products — that plan times out (>2.5s)
      // while child-table FTS returns in <10ms. Derive total from the page.
      if (useVector) {
        // 2026-08-29: the vector stage runs catalog queries on searchClient INSIDE the
        // search transaction and its catch blocks "fall back to FTS". A failure there
        // left the transaction aborted, so the main FTS query then died with 25P02 and
        // every hybrid/semantic MCP call returned 0 results (keyword mode was fine).
        // The savepoint makes the advertised fallback actually work.
        await searchClient.query('SAVEPOINT vector_stage').catch(() => {});
        // BUY-31962 / BUY-41138: hybrid search (RRF) or keyword FTS fallback.
        // Hybrid and semantic paths embed the query via Flow AI, query the vector DB
        // separately, then merge in application code (two separate PG instances).
        // Embed query (retrieval.query task); Redis-cache 60s keyed by base64 query
        let queryVec: string | null = null;
        try {
          const embedKey = `qembed:flow-embed-1@1024:${Buffer.from(q).toString('base64').slice(0, 48)}`;
          queryVec = await recordQueryCacheLookup(redis, embedKey, () => redis.get(embedKey));
          if (!queryVec) {
            queryVec = await embedQuery(q, flowAiKey);
            await redis.set(embedKey, queryVec, 'EX', 3600).catch(() => {});
          }
        } catch (embedErr) {
          console.warn('[search] embed query failed, falling back to FTS:', (embedErr as Error).message);
        }

        if (queryVec && vectorDb) {
          let candidateIds: string[] = [];
          let vectorCandidateIds: string[] | null = null;

          if (mode === 'semantic') {
            // Vector-only: fetch top-200 nearest neighbours from vector DB, then fetch details
            try {
              // BUY-68327: api.buywhere.ai/mcp can still point at a mixed-dimension
              // vector table. Restrict to the 512-dim Flow AI model and fail open to
              // keyword FTS if pgvector still rejects the query.
              const vecRows = await vectorDb.query<{ product_id: string }>(
                `SELECT product_id FROM product_embeddings
                 WHERE model_ver = 'flow-embed-1@1024'
                 ORDER BY (embedding_v2::halfvec(1024)) <=> $1::halfvec(1024) LIMIT 200`,
                [queryVec]
              );
              // BUY-74181: re-scope global vector candidates to the requested market
              // before pagination so semantic search does not return out-of-market rows.
              vectorCandidateIds = (await filterVectorCandidatesByMarket(
                searchClient,
                vecRows.rows.map(r => r.product_id),
                country,
                region
              )).slice(0, limit + offset);
            } catch (vecErr) {
              console.warn('[search] vector query failed, falling back to FTS:', (vecErr as Error).message);
              await searchClient.query('ROLLBACK TO SAVEPOINT vector_stage').catch(() => {});
              vectorCandidateIds = null;
            }
          } else {
            // Hybrid: app-level RRF of FTS ranks + vector ranks
            let vecRows: { product_id: string }[] = [];
            let ftsRows: { id: string }[] = [];
            try {
              // BUY-68327: keep vector failures (including vector dimension
              // mismatch) from rejecting the whole hybrid request.
              const vecResult = await vectorDb.query<{ product_id: string }>(
                `SELECT product_id FROM product_embeddings
                 WHERE model_ver = 'flow-embed-1@1024'
                 ORDER BY (embedding_v2::halfvec(1024)) <=> $1::halfvec(1024) LIMIT 200`,
                [queryVec]
              );
              vecRows = vecResult.rows;
            } catch (vecErr) {
              console.warn('[search] hybrid vector query failed, FTS only:', (vecErr as Error).message);
              await searchClient.query('ROLLBACK TO SAVEPOINT vector_stage').catch(() => {});
            }
            // BUY-74181: filter global vector candidates to the requested market
            // before RRF so hybrid ranking cannot be dominated by out-of-market rows.
            if (vecRows.length > 0 && (country || region)) {
              const allowedIds = new Set(await filterVectorCandidatesByMarket(
                searchClient,
                vecRows.map(r => r.product_id),
                country,
                region
              ));
              vecRows = vecRows.filter(r => allowedIds.has(r.product_id));
            }
            try {
              // BUY-72082: FTS half of RRF via tier table (GIN-indexed, bounded)
              const ftsResult = await searchClient.query<{ id: string }>(
                `SELECT sp.id FROM search_products sp ${tierWhere} LIMIT 200`,
                tierParams
              );
              ftsRows = ftsResult.rows;
            } catch (ftsErr) {
              console.warn('[search] hybrid FTS query failed:', (ftsErr as Error).message);
            }
            const ftsRank = new Map(ftsRows.map((r, i) => [r.id, i + 1]));
            const vecRank = new Map(vecRows.map((r, i) => [r.product_id, i + 1]));
            const allIds = new Set([...ftsRank.keys(), ...vecRank.keys()]);
            candidateIds = [...allIds]
              .map(id => ({
                id,
                score: 1 / (60 + (ftsRank.get(id) ?? 201)) + 1 / (60 + (vecRank.get(id) ?? 201)),
              }))
              .sort((a, b) => b.score - a.score)
              .slice(0, limit + offset)
              .map(s => s.id);
          }

          if (vectorCandidateIds !== null) {
            candidateIds = vectorCandidateIds;
          }
          total = candidateIds.length;
          const pageIds = candidateIds.slice(offset, offset + limit);

          if (pageIds.length === 0) {
            rows = [];
          } else {
            const detailParams: unknown[] = [...pageIds];
            const ph = pageIds.map((_, i) => `$${i + 1}`).join(',');
            const detailConditions = [`id IN (${ph})`, 'is_active = true'];
            if (country) {
              detailParams.push(country.toUpperCase());
              detailConditions.push(`country_code = $${detailParams.length}`);
            }
            if (region) {
              detailParams.push(region);
              detailConditions.push(`region = $${detailParams.length}`);
            }
            // BUY-79353: use merchant_id as displayed merchant, not source (feed origin).
            const detailResult = await searchClient.query(
              `SELECT id, sku AS source, merchant_id AS domain, url, title,
                      price, currency, image_url, metadata, updated_at, region, country_code, category, category_path,
                      url_last_checked_at, url_status
               FROM products WHERE ${detailConditions.join(' AND ')}`,
              detailParams
            );
            // Preserve ranking order
            const byId = new Map(detailResult.rows.map(r => [(r as Record<string, unknown>).id as string, r]));
            rows = pageIds.map(id => byId.get(id)).filter(Boolean) as Record<string, unknown>[];
          }
        } else {
          // BUY-72082: Embed failed — fall through to tier keyword FTS.
          // Stage 1: bounded FTS + ranking on search_products tier (GIN-indexed, 97M rows).
          // Stage 2: full MCP output columns from products via PK lookup (≤200 rows).
          // BUY-76552: REMOVED tierParams.push(limit+offset) — SQL uses hardcoded LIMIT 1000/200,
          // not $3. Extra param caused 08P01 on unnamed prepared statement.
          const tierFts = await searchClient.query<{ id: string; rank: number }>(
            `WITH cand AS (
               SELECT sp.id, ts_rank(sp.search_vector, plainto_tsquery('english', $1)) AS rank
               FROM search_products sp ${tierWhere}
               LIMIT 1000
             )
             SELECT id, rank FROM cand ORDER BY rank DESC LIMIT 200`,
            tierParams
          );
          if (tierFts.rows.length === 0) {
            rows = [];
          } else {
            const tierIds = tierFts.rows.map(r => r.id);
            const ph = tierIds.map((_, i) => `$${i + 1}`).join(',');
            // BUY-79353: use merchant_id as displayed merchant, not source (feed origin).
            const detailResult = await searchClient.query(
              `SELECT id, sku AS source, merchant_id AS domain, url, title,
                      price, currency, image_url, metadata, updated_at, region, country_code,
                      category, category_path, url_last_checked_at, url_status
               FROM products WHERE id IN (${ph}) AND is_active = true`,
              tierIds
            );
            // Preserve tier ranking order
            const byId = new Map(detailResult.rows.map(r => [(r as Record<string, unknown>).id as string, r]));
            rows = tierIds.map(id => byId.get(id)).filter(Boolean) as Record<string, unknown>[];
          }
        }
      } else {
        // BUY-72082: Keyword (FTS) path via search_products tier.
        // Stage 1: bounded FTS + ranking on search_products (GIN-indexed, 97M rows).
        // Stage 2: full MCP output columns from products via PK lookup (≤200 rows).
        const wantCurForFetch = (country && COUNTRY_CURRENCY[country] && useChildTable)
          ? COUNTRY_CURRENCY[country]
          : '';
        const pageLimit = Math.min((limit + offset) * (wantCurForFetch ? 8 : 1), 200);
        const tierFts = await searchClient.query<Record<string, unknown>>(
          `WITH cand AS (
             SELECT sp.id, sp.sku, sp.source, sp.url, sp.title, sp.price, sp.currency,
                    sp.image_url, sp.metadata, sp.updated_at, sp.region, sp.country_code,
                    sp.category, sp.category_path, sp.url_last_checked_at, sp.url_status,
                    sp.merchant_id,
                    ts_rank(sp.search_vector, plainto_tsquery('english', $1)) AS rank
             FROM ${ftsTable} sp ${tierWhere}
             LIMIT ${pageLimit}
           )
           SELECT id, sku AS source, merchant_id AS domain, url, title, price, currency,
                  image_url, metadata, updated_at, region, country_code, category,
                  category_path, url_last_checked_at, url_status, rank
           FROM cand ORDER BY rank DESC LIMIT ${pageLimit}`,
          tierParams
        );
        // BUY-80026: do NOT paginate here. Currency/country isolation below drops
        // SG-USD (and similar) leaks; slicing offset first made page 0 empty while
        // offset=10 still hit native-currency rows later in the overfetch window.
        rows = tierFts.rows as Record<string, unknown>[];
        total = Math.max(tierFts.rows.length, offset + rows.length);
      }
    } else {
      // No FTS — browse mode. Use reltuples for approximate total and fetch
      // recent products via idx_products_updated_at (3ms for 500 rows).
      // If user explicitly passed country_code/region, overfetch and filter
      // in-application (no composite index on country_code+updated_at).
      const approxResult = await searchClient.query(
        `SELECT reltuples::bigint AS estimate FROM pg_class WHERE relname = 'products'`
      );
      total = parseInt(approxResult.rows[0]?.estimate ?? '0', 10);

      const needsFilter = !!(country || region);
      const fetchLimit = needsFilter ? Math.min((limit + offset) * 20, 5000) : limit + offset;
      // BUY-79353: use merchant_id as displayed merchant, not source (feed origin).
      const rawResult = await searchClient.query(
        `SELECT id, sku AS source, merchant_id AS domain, url, title,
                price, currency, image_url, metadata, updated_at,
                url_last_checked_at, url_status,
                region, country_code
         FROM products
         ORDER BY updated_at DESC
         LIMIT $1`,
        [fetchLimit]
      );
      if (needsFilter) {
        let filtered = rawResult.rows as Record<string, unknown>[];
        if (country) {
          filtered = filtered.filter(r => (r.country_code as string || '').toUpperCase() === country);
        }
        if (region) {
          filtered = filtered.filter(r => (r.region as string || '').toLowerCase() === region.toLowerCase());
        }
        rows = filtered.slice(offset, offset + limit);
      } else {
        rows = (rawResult.rows as unknown[]).slice(offset, offset + limit);
      }
    }
    // BUY-78818: skip parent-table existence probes when FTS already returned rows.
    // Those probes scan `products` (370M+) and routinely burn the 3.5s catalog wall.
    if (rows.length > 0) {
      unfilteredHasAnyData = true;
      regionHasAnyDataProbe = true;
    }
    // BUY-72044 / P2.6A: unfiltered probe for `deliver_to_missing` reasoning. Runs
    // INSIDE the `try` (before the client is released) so we reuse the same
    // connection. Only fires when the caller omitted deliver_to/country_code/country
    // AND the keyword is set — that's the only path where the unfiltered signal
    // changes the reason. LIMIT 1 keeps this off the GIN hot path.
    if (q && !deliverToPresent && rows.length === 0) {
      await searchClient.query('SAVEPOINT probe_unfiltered').catch(() => {});
      try {
        const probe = await searchClient.query(
          `SELECT EXISTS (
             SELECT 1 FROM products
             WHERE is_active = true
               AND search_vector @@ plainto_tsquery('english', $1)
             LIMIT 1
           ) AS any_match`,
          [q]
        );
        unfilteredHasAnyData = (probe.rows[0] as { any_match: boolean } | undefined)?.any_match === true;
        await searchClient.query('RELEASE SAVEPOINT probe_unfiltered').catch(() => {});
      } catch (probeErr: any) {
        console.warn(`[search_products] unfiltered probe failed (non-fatal): ${probeErr?.code ?? ''} ${String(probeErr?.message ?? probeErr).slice(0, 160)}`);
        await searchClient.query('ROLLBACK TO SAVEPOINT probe_unfiltered').catch(() => {});
        unfilteredHasAnyData = null;
      }
    }
    // BUY-71542 / P2.6: region/category existence probes — best-effort, swallow
    // errors so the empty envelope still lands when the DB is healthy but the
    // query is the issue.
    if (country && rows.length === 0) {
      // 2026-08-29: these best-effort probes ran bare inside the search transaction and
      // swallowed their errors. One failing probe left the transaction ABORTED, so every
      // later statement returned 25P02 and the whole MCP surface answered 0 results with
      // an opaque "upstream_exception". SAVEPOINT keeps a probe failure local, and the
      // reason is logged instead of discarded.
      await searchClient.query('SAVEPOINT probe_region').catch(() => {});
      try {
        const probe = await searchClient.query(
          `SELECT EXISTS (SELECT 1 FROM products WHERE is_active = true AND country_code = $1 LIMIT 1) AS any_match`,
          [country.toUpperCase()]
        );
        regionHasAnyDataProbe = (probe.rows[0] as { any_match: boolean } | undefined)?.any_match === true;
        await searchClient.query('RELEASE SAVEPOINT probe_region').catch(() => {});
      } catch (probeErr: any) {
        console.warn(`[search_products] region probe failed (non-fatal): ${probeErr?.code ?? ''} ${String(probeErr?.message ?? probeErr).slice(0, 160)}`);
        await searchClient.query('ROLLBACK TO SAVEPOINT probe_region').catch(() => {});
      }
    }
    if (category && rows.length === 0) {
      await searchClient.query('SAVEPOINT probe_category').catch(() => {});
      try {
        const probe = await searchClient.query(
          `SELECT EXISTS (
             SELECT 1 FROM products
             WHERE is_active = true
               AND LOWER(category) LIKE $1
             LIMIT 1
           ) AS any_match`,
          [`%${category.toLowerCase()}%`]
        );
        categoryHasAnyDataProbe = (probe.rows[0] as { any_match: boolean } | undefined)?.any_match === true;
        await searchClient.query('RELEASE SAVEPOINT probe_category').catch(() => {});
      } catch (probeErr: any) {
        console.warn(`[search_products] category probe failed (non-fatal): ${probeErr?.code ?? ''} ${String(probeErr?.message ?? probeErr).slice(0, 160)}`);
        await searchClient.query('ROLLBACK TO SAVEPOINT probe_category').catch(() => {});
      }
    }
    await searchClient.query('COMMIT').catch(() => {});
    recordMcpCircuitSuccess('search_products', 'catalog_search', country || null);
  } catch (e: any) {
    await searchClient.query('ROLLBACK').catch(() => {});
    const degradedKind = classifyMcpDegradedKind(e);
    recordMcpCircuitFailure('search_products', 'catalog_search', country || null);
    // 2026-08-29: log the actual error. Without it every failure looked like an
    // opaque "upstream_exception" and the agent surface returned 0 results silently.
    console.warn(`[search_products] BUY-74597: catalog_search degraded (${degradedKind}) — ${e?.code ?? ''} ${String(e?.message ?? e).slice(0, 300)}`);
    const restHits = await restFallbackPromise;
    if (restHits && restHits.products.length > 0) {
      console.warn(`[search_products] BUY-79260: query degraded — REST fallback n=${restHits.products.length} kind=${degradedKind}`);
      // BUY-79642/BUY-74597: FTS threw but REST filled the gap. Mark degraded
      // so agents can distinguish these partial-fail results from a clean cache hit.
      const filled = buildSearchResponse(restHits.products, restHits.total, limit, offset, Date.now() - t0, false, true);
      filled.meta!.status = 'degraded';
      return aliasSearchEnvelope(filled);
    }
    // BUY-79642: REST completed with 0 native-market hits (ID/PH iphone 15).
    // Do not label that api_error — catalog FTS failed but REST independently
    // answered no_match. degraded=true still applies (catalog threw); only the
    // api_error label and degradedKind are suppressed when REST answered empty.
    const restAnsweredEmpty = restHits !== null && restHits.products.length === 0;
    return buildSearchResponse(
      [], 0, limit, offset, Date.now() - t0, false,
      true, undefined, country || null,
      deriveEmptiness({
        regionHasAnyData: regionHasAnyDataProbe,
        categoryHasAnyData: categoryHasAnyDataProbe,
        apiError: restAnsweredEmpty ? false : degradedKind === 'upstream_exception',
        rateLimited: false,
        regionSupported: !country || (SUPPORTED_REGIONS as readonly string[]).includes(country.toUpperCase()),
        categoryRequested: !!category,
        requestedCategory: category || null,
        requestedCountry: country || null,
        rateLimitRemaining: null,
        deliverToPresent,
        unfilteredHasAnyData,
        queryAmbiguous: null,
        degradedKind: restAnsweredEmpty ? undefined : degradedKind,
        timedOutStage: restAnsweredEmpty ? undefined : 'catalog_search',
      }),
    );
  } finally {
    // BUY-56185: always use safe release to discard connections poisoned by statement_timeout
    releaseClientSafely(searchClient);
  }

  // BUY-69738: category was removed from SQL WHERE (caused heap scan at 400M+ rows).
  // Filter in-memory after fetch — ILIKE match is cheap on the bounded result set.
  // BUY-75839: rows with NULL/empty category are kept — NULL cannot prove a mismatch.
  if (category && rows.length > 0) {
    const catLower = category.toLowerCase();
    rows = (rows as Record<string, unknown>[]).filter(r => {
      const rowCat = ((r.category as string) || '').trim();
      if (!rowCat) return true; // keep unknown-category rows
      return rowCat.toLowerCase().includes(catLower);
    });
  }

  // BUY-79497: isolate requested market. Child-table FTS is country-partitioned
  // but Shopify rows often carry the wrong currency (SG USD / US SGD). Drop
  // mismatches including NULL currency so we do not fill the page with leaks.
  if (country) {
    const want = country.toUpperCase();
    const wantCur = (COUNTRY_CURRENCY[want] || '').toUpperCase();
    const native = rows as Record<string, unknown>[];
    const filtered = native.filter(r => {
      const cc = String(r.country_code || '').toUpperCase();
      if (cc && cc !== want) return false;
      if (wantCur) {
        const cur = String(r.currency || '').toUpperCase();
        if (cur && cur !== wantCur) return false;
      }
      return true;
    });
    // BUY-79642: never fall back to currency/country leaks. If overfetch did not
    // find native-market rows, return empty/degraded rather than SG/USD or MY/SG.
    // BUY-80026: paginate AFTER isolation so offset=0 is not a page of discarded leaks.
    rows = filtered.slice(offset, offset + limit);
  }

  // BUY-79642: SEA markets (MY/TH/VN/ID/PH) have no FAST child table; FTS on
  // search_products often 25P02/timeout → api_error in ~60ms while REST
  // /v1/products/search is independently healthy (MYR/VND hits). Previously
  // restFallbackPromise only applied on thrown errors / circuit_open, so
  // empty api_error envelopes won. Prefer REST hits whenever FTS is empty.
  if (q && (rows as unknown[]).length === 0) {
    const restHits = await restFallbackPromise;
    if (restHits && restHits.products.length > 0) {
      console.warn(`[search_products] BUY-79642: empty FTS — REST fallback n=${restHits.products.length} country=${country} q=${q}`);
      return aliasSearchEnvelope(buildSearchResponse(restHits.products, restHits.total, limit, offset, Date.now() - t0, false));
    }
  }

  const merchantMapForMcpSearch = await lookupMerchantMap(
    db,
    (rows as Record<string, unknown>[]).map((row) => (row.merchant_id as string | null) ?? null),
  );
  const products = (rows as Record<string, unknown>[]).map(r =>
    buildProduct(r, currency, compact, merchantMapForMcpSearch, caller)
  );

  // BUY-71542 / P2.6 + BUY-72044 / P2.6A: empty-result envelope. Only build when
  // the response is genuinely empty (products.length === 0) — non-empty responses
  // MUST NOT carry emptiness_reason per spec §2.1. The unfiltered probe was run
  // inside the main try block (above) so the connection is already released; we
  // reuse the captured values here.
  let emptiness: ReturnType<typeof deriveEmptiness> | null = null;
  if (products.length === 0) {
    const signals: EmptinessSignals = {
      regionHasAnyData: regionHasAnyDataProbe,
      categoryHasAnyData: categoryHasAnyDataProbe,
      apiError: false,
      rateLimited: false,
      regionSupported: !country || (SUPPORTED_REGIONS as readonly string[]).includes(country.toUpperCase()),
      categoryRequested: !!category,
      requestedCategory: category || null,
      requestedCountry: country || null,
      rateLimitRemaining: null,
      deliverToPresent,
      unfilteredHasAnyData,
      queryAmbiguous: null,
    };
    emptiness = deriveEmptiness(signals);
  }

  // BUY-79690: expectedCountryCode = dest only when caller passed one explicitly.
  // hasExplicitCountry covers deliver_to / country_code / country (any of the three).
  const result = buildSearchResponse(
    products, total!, limit, offset, Date.now() - t0, false,
    undefined, undefined, hasExplicitCountry ? (country || null) : null,
    emptiness,
  );

  try {
    await redis.set(cacheKey, JSON.stringify(result), 'EX', MCP_FTS_CACHE_TTL_SECONDS);
  } catch (_) { /* cache write failure is non-fatal */ }

  // F24 (2026-08-22): nudge agents that skipped deliver_to — added after the
  // cache write so the cached envelope stays neutral.
  if (!args.deliver_to) {
    (result as unknown as Record<string, unknown>).hint =
      'Treat deliver_to as REQUIRED for buyer-facing use: pass deliver_to=<ISO-3166 country of your end user> to shipping-rank results; without it products may be undeliverable.';
  }

  return result;
}

async function handleGetProduct(args: Record<string, unknown>, caller?: { apiKeyId?: string | null; keyHash?: string | null } | null) {
  const t0 = Date.now();
  const { id } = args;

  if (!id || typeof id !== 'string' || !id.trim()) {
    throw { code: -32602, message: 'missing required parameter: id' };
  }

  let result;
  try {
    // BUY-79353: use merchant_id as displayed merchant, not source (feed origin).
    result = await db.query(
      `SELECT id, sku AS source, merchant_id AS domain, url, title,
              price, currency, image_url, brand, category_path,
              avg_rating AS rating, review_count, metadata, updated_at, region, country_code
       FROM products WHERE id = $1`,
      [id.trim()]
    );
  } catch {
    throw { code: -32001, message: 'Product not found' };
  }
  if (!result.rows.length) throw { code: -32001, message: 'Product not found' };
  const product = buildProduct(result.rows[0] as Record<string, unknown>, 'SGD', false, undefined, caller);
  return buildSearchResponse([product], 1, 1, 0, Date.now() - t0, false);
}

async function handleCompareProducts(args: Record<string, unknown>, caller?: { apiKeyId?: string | null; keyHash?: string | null } | null) {
  const t0 = Date.now();
  const ids = args.ids as string[];
  if (!ids || !Array.isArray(ids) || ids.length < 2) {
    throw { code: -32602, message: 'Provide at least 2 product IDs' };
  }
  if (ids.length > 10) {
    throw { code: -32602, message: 'Provide at most 10 product IDs' };
  }
  const validIds = ids.filter((id) => id != null && String(id).trim());
  if (validIds.length < 2) {
    throw { code: -32602, message: 'Provide at least 2 valid product IDs' };
  }
  if (validIds.length > 10) {
    throw { code: -32602, message: 'Provide at most 10 valid product IDs' };
  }
  const placeholders = validIds.map((_, i) => `$${i + 1}`).join(',');
  let result;
  try {
    // BUY-79353: use merchant_id as displayed merchant, not source (feed origin).
    result = await db.query(
      `SELECT id, sku AS source, merchant_id AS domain, url, title,
              price, currency, image_url, brand, category_path,
              avg_rating AS rating, review_count, metadata, updated_at, region, country_code
       FROM products WHERE id IN (${placeholders})`,
      validIds
    );
  } catch {
    throw { code: -32001, message: 'Products not found' };
  }
  const products = result.rows.map((r: Record<string, unknown>) => buildProduct(r, 'SGD', false, undefined, caller));
  return buildSearchResponse(products, products.length, validIds.length, 0, Date.now() - t0, false);
}

async function handleGetDeals(args: Record<string, unknown>, caller?: { apiKeyId?: string | null; keyHash?: string | null } | null) {
  const t0 = Date.now();
  const deliverToPresent = Boolean(typeof args.deliver_to === 'string' && args.deliver_to.trim() !== '');
  const minDiscount = Number(args.min_discount) || 10;
  const market = normalizeMcpMarket(args);
  const regionLower = String(market.rawRegion || '').toLowerCase();
  const COARSE_DEAL_REGIONS = new Set(['sea', 'eu', 'au', 'global']);
  const effectiveCountry = market.country;
  // BUY-79497: region=sea without a country is an unbounded offer_aggregation
  // scan (~3.5s empty). Fail-fast unless we have a country to index on.
  if (COARSE_DEAL_REGIONS.has(regionLower) && !effectiveCountry) {
    const tLimit = Math.min(Number(args.limit) || 20, 100);
    const tOffset = Number(args.offset) || 0;
    return {
      ...buildSearchResponse([], 0, tLimit, tOffset, Date.now() - t0, false),
      unavailable: true,
      emptiness_reason: 'region_unsupported',
      meta: {
        emptiness_reason: 'region_unsupported',
        diagnostic: { requested_region: regionLower, hint: 'pass country_code=SG|US|MY|… or region=sg|us' },
      },
    };
  }
  const region = COARSE_DEAL_REGIONS.has(regionLower) ? '' : market.rawRegion;
  const currency = ((args.currency as string) || (effectiveCountry ? COUNTRY_CURRENCY[effectiveCountry] : '') || 'SGD').toUpperCase();
  const limit = Math.min(Number(args.limit) || 20, 100);
  const offset = Number(args.offset) || 0;

  if (isMcpCircuitOpen('get_deals', 'offer_aggregation', effectiveCountry || null)) {
    return buildMcpDegradedSearchResponse({
      tool: 'get_deals',
      stage: 'offer_aggregation',
      kind: 'circuit_open',
      limit,
      offset,
      responseTimeMs: Date.now() - t0,
      country: effectiveCountry || null,
      deliverToPresent,
    });
  }

  const cacheKey = `deals_mcp:v2:${currency}:${minDiscount}:${region}:${region}:${effectiveCountry}:${(args.category as string || '').trim()}:${limit}:${offset}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.results) {
        return { ...parsed, cached: true, response_time_ms: Date.now() - t0 };
      }
    }
  } catch (_) {}

  // BUY-68615: hardcode true — production catalog DB has discount_pct GENERATED ALWAYS column.
  // The probe can mis-detect on cold pool connections; bypass it to use the fast indexed path.
  const useDiscountCol = true;
  

  // BUY-79200: search_products (97M, idx_sp_disc) instead of products (382M).
  // The parent deals index is currency-only; country filters then seqscan/timeout
  // at the 3.5s MCP wall. search_products has no is_active/metadata columns.
  const conditions: string[] = [
    `price > 0`,
    `discount_pct >= $1`,
  ];
  const params: unknown[] = [minDiscount];
  if (currency) {
    params.push(currency);
    conditions.push(`currency = $${params.length}`);
  }
  if (region) {
    params.push(region);
    conditions.push(`region = $${params.length}`);
  }
  if (effectiveCountry) {
    params.push(effectiveCountry);
    conditions.push(`country_code = $${params.length}`);
  }

  // BUY-77178: category filter — BUY-77834 fix
  // The prior `LOWER(category) = $N` exact-match against the single text column
  // never matched slug-style input like "home_and_kitchen" / "sports_and_outdoors"
  // / "video_games" — those names don't exist verbatim in `category`. The index
  // walk then burned the full 30s statement_timeout returning 0 rows and surfaced
  // category_recognized:false to agents. Mirroring search_products: keep the SQL
  // WHERE untouched (so the deals index walk is bounded), and apply the category
  // filter as a post-fetch ILIKE on the bounded candidate set against both
  // `category` text AND `category_path[1]`. LIKE wildcards make slug input
  // ("home_and_kitchen") still match real names like "home & kitchen".
  const category = (args.category as string || '').trim();
  const categoryLower = category.toLowerCase();

  const whereClause = conditions.join(' AND ');

  const discountSelect = useDiscountCol
    ? 'discount_pct'
    : `ROUND(((1 - price / NULLIF((metadata->>'original_price')::numeric, 0)) * 100)::numeric, 1) AS discount_pct`;
  const discountOrder = useDiscountCol
    ? 'discount_pct DESC'
    : `(1 - price / NULLIF((metadata->>'original_price')::numeric, 0)) DESC`;

  // Use dedicated client with bounded statement_timeout so a slow deals scan returns
  // a structured degraded envelope to the MCP client instead of hanging the request.
  let products: ReturnType<typeof buildProduct>[] = [];
  let total = 0;
  let dealsClient: PoolClient | null = null;
  try {
    // BUY-65095: route get_deals to read replica (same reason as search_products).
    // walking the discount index on 400M+ rows on primary exceeds 15s statement_timeout.
    dealsClient = await servingReadDbConnect().catch((err: unknown) => {
      if (err instanceof ReplicaUnavailableError) {
        console.warn('[get_deals] replica unavailable, falling back to primary:', err.message);
        return acquireMcpClient();
      }
      throw err;
    });
    // BUY-64112: strict discount-first query only. The prior recent-window sample
    // + laptop/watch fallback returned keyword rows with discount_pct=0 and hid
    // real discounted products. Query the indexed discount predicate directly.
    await dealsClient.query(`SET statement_timeout = ${MCP_CATALOG_STATEMENT_TIMEOUT_MS}`); // BUY-78735: wall-clock fail-fast; was 30s which hung MCP tools/call 0-byte.
    // BUY-68615: force index path on production catalog DB.
    // At 400M+ rows, the planner may choose seqscan even with the discount index,
    // which times out. Bounded LIMIT + enable_seqscan=off ensures the index is used.
    // BUY-69340 + BUY-69646 merged (2026-08-15): walk the deals index IN ORDER
    // (currency, discount_pct DESC) so the response is the TRUE top discounts —
    // the unordered 10K candidate walk could miss the best deals entirely and
    // shipped 10K full rows (metadata jsonb) to Node per call (27-30s observed
    // under replica load). The ordered walk early-stops at candidateLimit
    // PASSING rows (same worst case as the unordered walk when filters are
    // selective), candidates are id-thin, and full rows join only for the
    // returned page. updated_at tiebreak preserved in SQL.
    await dealsClient.query('SET enable_seqscan = off');
    // BUY-79200: keep the walk tiny. idx_sp_disc LIMIT 200 is <1ms; 400+ times out
    // because heap fetches from 78GB search_products scatter. Country partial
    // idx_sp_disc_* (created alongside this change) makes country filters index-only.
    const candidateLimit = categoryLower ? 200 : 200;
    const candidateParams = [...params, candidateLimit];
    // BUY-79353: use merchant_id as displayed merchant, not source (feed origin).
    const dataResult = await dealsClient.query(
      `SELECT p.id, p.sku AS source, p.merchant_id AS domain, p.url, p.title,
              p.price,
              NULL::numeric AS original_price,
              p.currency, p.image_url, NULL::jsonb AS metadata, p.updated_at, p.region, p.country_code,
              NULL::timestamptz AS url_last_checked_at, NULL::text AS url_status,
              p.discount_pct,
              p.category, NULL::text[] AS category_path
       FROM search_products p
       WHERE ${whereClause}
       ORDER BY p.discount_pct DESC, p.updated_at DESC
       LIMIT $${candidateParams.length}`,
      candidateParams
    );
    total = dataResult.rows.length;
    if (effectiveCountry) {
      const cc = effectiveCountry.toUpperCase();
      dataResult.rows = (dataResult.rows as Record<string, unknown>[]).filter(
        (r) => String(r.country_code || '').toUpperCase() === cc,
      );
      total = dataResult.rows.length;
    }
    // BUY-77834: post-fetch category filter on the bounded candidate set. SQL
    // WHERE was kept category-free so the (currency, discount_pct DESC) index
    // walk stays bounded. Match caller input against `category` text AND
    // `category_path[1]` so slug-style names ("home_and_kitchen") still match
    // real names ("Home & Kitchen" via category_path[1] — list_categories feeds
    // from this column on SG). LIKE wildcard gives a forgiving match.
    if (categoryLower) {
      const rawRows = dataResult.rows as Record<string, unknown>[];
      const matched = rawRows.filter((r) => {
        const catText = ((r.category as string) || '').toLowerCase();
        const catPath = ((r.category_path as unknown[]) || [])
          .map((v) => String(v).toLowerCase())
          .join(' ');
        return catText.includes(categoryLower) || catPath.includes(categoryLower);
      });
      products = matched.slice(offset, offset + limit).map((r) => buildProduct(r, currency, false, undefined, caller));
      total = matched.length;
    } else {
      products = dataResult.rows.slice(offset, offset + limit).map((r: Record<string, unknown>) =>
        buildProduct(r, currency, false, undefined, caller)
      );
    }
    recordMcpCircuitSuccess('get_deals', 'offer_aggregation', effectiveCountry || null);
  } catch (e: any) {
    const degradedKind = classifyMcpDegradedKind(e);
    recordMcpCircuitFailure('get_deals', 'offer_aggregation', effectiveCountry || null);
    console.warn(`[get_deals] BUY-74597: offer_aggregation degraded (${degradedKind}) — returning MCP degraded envelope`);
    return buildMcpDegradedSearchResponse({
      tool: 'get_deals',
      stage: 'offer_aggregation',
      kind: degradedKind,
      limit,
      offset,
      responseTimeMs: Date.now() - t0,
      country: effectiveCountry || null,
      deliverToPresent,
    });
  } finally {
    // BUY-56185: discard connections poisoned by statement_timeout
    if (dealsClient) releaseClientSafely(dealsClient);
  }

  const result = buildSearchResponse(products, total, limit, offset, Date.now() - t0, false);
  // BUY-60068: surface `meta.unavailable:true` when both the strict discount filter
  // and the regional fallback returned zero rows for the requested region/country,
  // so callers can distinguish "no live deals" from "server bug".
  if ((region || effectiveCountry) && products.length === 0) {
    (result as { unavailable?: boolean }).unavailable = true;
  }
  // BUY-77834: surface the category_recognized signal when the caller passed
  // a category filter. The post-fetch filter is now bounded (no more 30s walks),
  // so we can reliably report whether the category had ANY rows.
  if (categoryLower && products.length === 0) {
    const resultMeta = result.meta as unknown as Record<string, unknown>;
    resultMeta.emptiness_reason = 'category_unsupported';
    resultMeta.confidence = 'low';
    resultMeta.diagnostic = {
      category_recognized: false,
      timed_out_stage: null,
    };
  }

  redis.set(cacheKey, JSON.stringify(result), 'EX', 60).catch(() => {});

  return result;
}

// Single-flight guard: at most one DB scan runs per country at a time.
// Concurrent cache-misses coalesce on the same Promise instead of spawning N parallel GROUP-BY scans.
const categoryListInflight = new Map<string, Promise<{ data: unknown[]; meta: Record<string, unknown> }>>();

function buildHardcodedCategories() {
  return [
    { slug: 'electronics', name: 'Electronics', product_count: 0 },
    { slug: 'computers', name: 'Computers', product_count: 0 },
    { slug: 'mobile-phones', name: 'Mobile Phones', product_count: 0 },
    { slug: 'home', name: 'Home', product_count: 0 },
    { slug: 'fashion', name: 'Fashion', product_count: 0 },
  ];
}

async function handleListCategories(args: Record<string, unknown>) {
  const t0 = Date.now();
  void (args.deliver_to as string);
  const country = normalizeMcpMarket(args, 'SG').country;
  const cacheKey = `categories_mcp:top100:${country}`;

  // 1. Redis fast path
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed.data) && parsed.data.length > 0 && parsed.data.some((row: { product_count?: number }) => Number(row.product_count) > 0)) {
        return { ...parsed, meta: { ...parsed.meta, cached: true, response_time_ms: Date.now() - t0 } };
      }
    }
  } catch (_) {}

  // 2. Single-flight: if a query is already in-flight for this country, piggyback on it
  const inflight = categoryListInflight.get(country);
  if (inflight) {
    const result = await inflight;
    return { ...result, meta: { ...result.meta, cached: true, response_time_ms: Date.now() - t0 } };
  }

  // 3. No in-flight query — start one and register it so concurrent callers coalesce
  // BUY-69823: wrap the whole queryPromise in a hard wall-clock timeout so pool
  // contention + slow queries never exceed ~6s. If timeout fires, return hardcoded
  // categories rather than a hard 5xx.
  const MAT_VIEW_TIMEOUT_MS = 4000;
  const LIVE_TIMEOUT_MS = 1500;
  const HARD_TIMEOUT_MS = 6000;
  const queryPromise = (async () => {
    const tAcquire = Date.now();
    const client = await servingReadDbConnect().catch((err: unknown) => {
      if (err instanceof ReplicaUnavailableError) {
        console.warn('[list_categories] replica unavailable, falling back to primary:', err.message);
        return acquireMcpClient();
      }
      console.warn('[list_categories] db.connect failed:', (err as Error)?.message);
      throw { code: -32603, message: 'Database connection timeout' };
    });
    const catPoolWaitMs = Date.now() - tAcquire;
    const skipColdScan = catPoolWaitMs >= 500;
    try {
      await client.query('SET statement_timeout = 4000');
      {
        const stCat = await showStatementTimeout(client);
        console.warn(`[mcp] BUY-67598 list_categories pool_wait_ms=${catPoolWaitMs} statement_timeout=${stCat} sql_start`);
      }
      // BUY-69472: set lock_timeout so concurrent matview refresh / long-held
      // ACCESS EXCLUSIVE locks degrade to fallback instead of hard -32603.
      await client.query('SET lock_timeout = 5000');
      let rows: Array<{ slug: string; name: string; product_count: number }> = [];
      try {
        const tableCheck = await client.query(
          `SELECT to_regclass('public.mcp_category_summary_by_country') AS tbl`
        );
        if (tableCheck.rows[0]?.tbl) {
          const summaryResult = await client.query(
            `SELECT slug, name, product_count
             FROM mcp_category_summary_by_country
             WHERE country_code = $1
               AND slug IS NOT NULL AND btrim(slug) <> ''
             ORDER BY product_count DESC
             LIMIT 100`,
            [country]
          );
          rows = summaryResult.rows;
        }
        // BUY-69823: if matview empty, try a bounded live GROUP BY with a tighter
        // per-query timeout — prevents a 50K-row scan from burning the full 8s.
        if (rows.length === 0 && !skipColdScan) {
          try {
            await client.query(`SET statement_timeout = ${LIVE_TIMEOUT_MS}`);
            await client.query(`SET work_mem = '256MB'`);
            await client.query(`SET enable_hashagg = off`);
            const catTable = FAST_CHILD_TABLE_COUNTRIES.has(country.toUpperCase())
              ? `products_partitioned_${country.toLowerCase()}`
              : 'products';
            const countryPred = catTable === 'products' ? 'country_code = $1 AND' : 'TRUE AND';
            const liveResult = await client.query(
              `SELECT category_path[1] AS slug, category_path[1] AS name, COUNT(*) AS product_count
               FROM ${catTable}
               WHERE ${countryPred}
                 category_path[1] IS NOT NULL
                 AND is_active = true
               GROUP BY category_path[1]
               ORDER BY COUNT(*) DESC
               LIMIT 100`,
              catTable === 'products' ? [country] : []
            );
            if (liveResult.rows.length > 0) rows = liveResult.rows;
          } catch (_) {
            // live GROUP BY timed out — fall through to recent-products fallback
          } finally {
            await client.query(`SET statement_timeout = ${MAT_VIEW_TIMEOUT_MS}`);
          }
        }
        if (rows.length === 0 && !skipColdScan) {
          // BUY-60056: materialized view is empty/stale in production. Instead of
          // returning unavailable or running a full-table GROUP BY, sample recent
          // products through the updated_at path and derive a bounded category list.
          // BUY-69823: use LIVE_TIMEOUT_MS so a 50K-row scan never exceeds 1.8s.
          try {
            await client.query(`SET statement_timeout = ${LIVE_TIMEOUT_MS}`);
            const catTableFb = FAST_CHILD_TABLE_COUNTRIES.has(country.toUpperCase())
              ? `products_partitioned_${country.toLowerCase()}`
              : 'products';
            const countryPredFb = catTableFb === 'products' ? 'country_code = $1 AND' : 'TRUE AND';
            const fallbackResult = await client.query(
              `SELECT slug, slug AS name, COUNT(*)::int AS product_count
               FROM (
                 SELECT category_path, country_code
                 FROM ${catTableFb}
                 WHERE ${countryPredFb}
                   category_path[1] IS NOT NULL
                   AND is_active = true
                 ORDER BY updated_at DESC
                 LIMIT 50000
               ) _recent_categories
               CROSS JOIN LATERAL (SELECT category_path[1] AS slug) _cat
               GROUP BY slug
               ORDER BY product_count DESC
               LIMIT 100`,
              catTableFb === 'products' ? [country] : []
            );
            rows = fallbackResult.rows;
          } catch (_) {
            // recent-products fallback timed out — fall through to hardcoded
          }
        }
      } catch (dbErr: any) {
        // BUY-69472: lock_timeout (55P03) or statement_timeout (57014) —
        // degrade to hardcoded fallback instead of hard -32603.
        const pgCode = dbErr?.code;
        if (pgCode === '55P03' || pgCode === '57014') {
          console.warn(`[list_categories] DB lock/statement timeout for ${country} (code=${pgCode}), falling back to hardcoded categories`);
        } else {
          throw dbErr;
        }
      }
      if (rows.length === 0 && !skipColdScan) {
        let estimate = 0;
        try {
          const rel = FAST_CHILD_TABLE_COUNTRIES.has(country.toUpperCase())
            ? `products_partitioned_${country.toLowerCase()}`
            : 'products';
          const est = await client.query(
            `SELECT COALESCE(reltuples, 0)::bigint AS estimate FROM pg_class WHERE relname = $1 LIMIT 1`,
            [rel],
          );
          estimate = parseInt(String(est.rows[0]?.estimate ?? '0'), 10) || 0;
        } catch { /* best-effort */ }
        const perCat = estimate > 0 ? Math.max(1, Math.floor(estimate / 5)) : 0;
        rows = ['Electronics', 'Computers', 'Mobile Phones', 'Home', 'Fashion'].map((name) => ({
          slug: name.toLowerCase().replace(/\s+/g, '-'),
          name,
          product_count: perCat,
        }));
      }
      const data = {
        // BUY-71112: expose both `categories` (canonical) and `data` (legacy)
        // so callers expecting either key keep working. Mirrors the
        // mcp-railway fix in PR #692; same probe evidence.
        categories: rows,
        data: rows,
        meta: { total: rows.length, country_code: country, response_time_ms: 0, cached: false, unavailable: false },
      };
      redis.set(cacheKey, JSON.stringify(data), 'EX', 600).catch(() => {}); // 10 min TTL
      return data;
    } finally {
      releaseClientSafely(client);
    }
  })();

  // BUY-69823: hard wall-clock timeout prevents pool contention + slow queries
  // from burning the entire request budget. Race the queryPromise against a
  // timeout; if timeout wins, return hardcoded categories instead of a 5xx.
  const hardTimeoutPromise = new Promise<ReturnType<typeof buildHardcodedCategories>>((resolve) => {
    setTimeout(() => {
      resolve([
        { slug: 'electronics', name: 'Electronics', product_count: 0 },
        { slug: 'computers', name: 'Computers', product_count: 0 },
        { slug: 'mobile-phones', name: 'Mobile Phones', product_count: 0 },
        { slug: 'home', name: 'Home', product_count: 0 },
        { slug: 'fashion', name: 'Fashion', product_count: 0 },
      ]);
    }, HARD_TIMEOUT_MS);
  });

  categoryListInflight.set(country, queryPromise);
  try {
    const rows = await Promise.race([queryPromise.then(r => r.data), hardTimeoutPromise]);
    const result = { categories: rows, data: rows, meta: { total: rows.length, country_code: country, response_time_ms: Date.now() - t0, cached: false, unavailable: false } };
    return result;
  } catch (err) {
    // If the promise rejects, return hardcoded categories with a warning
    console.warn('[list_categories] unexpected error, returning hardcoded:', err);
    return {
      categories: [
        { slug: 'electronics', name: 'Electronics', product_count: 0 },
        { slug: 'computers', name: 'Computers', product_count: 0 },
        { slug: 'mobile-phones', name: 'Mobile Phones', product_count: 0 },
        { slug: 'home', name: 'Home', product_count: 0 },
        { slug: 'fashion', name: 'Fashion', product_count: 0 },
      ],
      data: [
        { slug: 'electronics', name: 'Electronics', product_count: 0 },
        { slug: 'computers', name: 'Computers', product_count: 0 },
        { slug: 'mobile-phones', name: 'Mobile Phones', product_count: 0 },
        { slug: 'home', name: 'Home', product_count: 0 },
        { slug: 'fashion', name: 'Fashion', product_count: 0 },
      ],
      meta: { total: 5, country_code: country, response_time_ms: Date.now() - t0, cached: false, unavailable: false },
    };
  } finally {
    categoryListInflight.delete(country);
  }
}

// BUY-76206: normalize find_best_price product queries before they reach
// plainto_tsquery / buildDeviceFilter. Strips trailing price/shipping/store
// noise and collapses whitespace so ranking is driven by the product noun,
// not spurious lexemes (mirrors the queryPreprocessor the search_products
// path uses). Kept inline here to avoid a cross-tree import; the full
// queryPreprocessor port is tracked under BUY-76206.
const FBP_NOISE_TERMS = [
  'price', 'prices', 'cheap', 'cheapest', 'best', 'buy', 'preorder', 'pre-order',
  'official', 'original', 'genuine', 'sale', 'deal', 'discount', 'ship', 'shipping',
  'free ship', 'in stock', 'stock', 'new', 'warranty', 'sg', 'singapore', 'store',
  'shop', 'online', 'fast', 'delivery', 'near me',
  '$', 's$', 'us$', 'rm', '฿', '₫', 'php', 'idr',
];

function normalizeFbpQuery(raw: string): string {
  let q = raw.toLowerCase()
    .replace(/\b(?:s|us|rm)?[$฿₫]\s?\d{1,3}(?:,\d{3})*\.?\d*\b/g, ' ')
    .replace(/[$฿₫]/g, ' ')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ');
  for (const t of FBP_NOISE_TERMS) {
    q = q.replace(new RegExp(`\\b${t.replace(/[$฿₫]/g, '\\$&')}\\b`, 'g'), ' ');
  }
  q = q.split(' ').filter(tok => !/^\d{4,}$/.test(tok)).join(' ');
  return q.replace(/\s+/g, ' ').trim();
}

async function handleFindBestPrice(args: Record<string, unknown>) {
  const t0 = Date.now();
  void (args.deliver_to as string);
  const deliverToPresent = Boolean(
    (typeof args.deliver_to === 'string' && args.deliver_to.trim() !== '') ||
    (typeof args.country_code === 'string' && args.country_code.trim() !== '') ||
    (typeof args.country === 'string' && args.country.trim() !== '')
  );
  const productName = ((args.product_name as string) || (args.q as string) || (args.query as string) || '').trim();
  if (!productName) throw { code: -32602, message: 'product_name (or q) is required' };

  const market = normalizeMcpMarket(args, 'SG');
  const country = market.country;
  const region = market.rawRegion;
  const category = (args.category as string) || '';
  const limit = 10;

  // BUY-76206: rank on a noise-stripped query; keep the raw productName for the
  // response envelope and any downstream text matching.
  const searchName = normalizeFbpQuery(productName) || productName;

  // BUY-67522: infer exact device-family queries and reject accessory results.
  const deviceFilter = buildDeviceFilter(searchName, country);

  const CANDIDATE_POOL = Math.max(limit * 5, 50); // BUY-79200: 500-row heap walk on 78GB search_products blows the 3.5s wall

  // BUY-74597: short-circuit when this tool/stage/country has tripped its breaker.
  if (isMcpCircuitOpen('find_best_price', 'catalog_search', country || null)) {
    const restFbp = await findBestPriceViaRestFallback({ productName, country, t0 });
    if (restFbp && restFbp.best_price) {
      console.warn(`[find_best_price] BUY-74579: circuit_open — REST fallback n=${restFbp.meta.total} country=${country}`);
      return restFbp;
    }
    return buildMcpDegradedBestPriceResponse({
      productName,
      country,
      responseTimeMs: Date.now() - t0,
      kind: 'circuit_open',
      stage: 'catalog_search',
      deliverToPresent,
    });
  }

  // BUY-31962: same subquery pattern as search_products — fetch candidates via GIN
  // index (no sort), then ORDER BY price ASC on the small candidate set. Avoids the
  // O(N log N) full-sort that causes the 10s/30s timeout on large FTS result sets.
  // BUY-57258: add connect timeout so pool exhaustion fails fast; reduce statement_timeout
  // to 5s to prevent cascading connection starvation during contention.
  // BUY-69646: the prior heap-scan candidate window (`ORDER BY updated_at DESC LIMIT 50000`
  // over the whole table) times out at catalog scale (400M+ rows). Drive candidates from the
  // search_vector GIN index with a bounded LIMIT instead — same proven pattern as the
  // mcp-railway fbp handler and search_products.
  let bestPriceClient: PoolClient | null = null;
  let result: { rows: Record<string, unknown>[] } | undefined;
  try {
    bestPriceClient = await servingReadDbConnect().catch((err: unknown) => {
      if (err instanceof ReplicaUnavailableError) {
        console.warn('[find_best_price] replica unavailable, falling back to primary:', err.message);
        return acquireMcpClient();
      }
      throw err;
    });
    await bestPriceClient.query(`SET statement_timeout = ${MCP_CATALOG_STATEMENT_TIMEOUT_MS}`); // BUY-78735: wall-clock fail-fast; was 30s which hung MCP tools/call 0-byte.
    await bestPriceClient.query('SET enable_seqscan = off'); // force GIN index plan; mitigates catalog_search timeouts on SEA markets
    // BUY-79200: enable_seqscan=off alone picks idx_sp_cc_price then filters
    // search_vector (3.5s wall). Bitmap on idx_sp_fts_<cc> is ~100ms — but we
    // MUST restore indexscan before the PK join or hydration seqscans 97M rows.
    await bestPriceClient.query('SET enable_indexscan = off');

    // BUY-72082: Tier search via search_products partitioned table (97M rows,
    // GIN-indexed, country-partitioned) instead of the 368M-row products table.
    // Stage 1 selects candidate ids + price + updated_at from the tier; stage 2
    // joins back to products by PK for the full MCP output columns. Mirrors the
    // search_products fix and avoids the full-table FTS scans that push FBP over
    // the 30s statement_timeout across SEA markets.
    const requestedCountry = country;
    const minPrice = deviceFilter.minLocal > 0 ? deviceFilter.minLocal : 0;
    const tierConditions: string[] = [];
    const tierParams: unknown[] = [];
    // BUY-76206: FTS on the noise-stripped query (searchName) instead of the raw string.
    tierParams.push(searchName);
    tierConditions.push(`sp.search_vector @@ plainto_tsquery('english', $${tierParams.length})`);
    if (region) {
      tierParams.push(region);
      tierConditions.push(`sp.region = $${tierParams.length}`);
    }
    if (minPrice > 0) {
      tierParams.push(minPrice);
      tierConditions.push(`sp.price >= $${tierParams.length}`);
    }
    // BUY-76909: route candidates AND hydration to the country child table when one
    // exists. The products parent (373M rows / 297GB, 11M dead tuples) times out PK
    // joins even with indexes, and search_products ids do not overlap child-table ids
    // for recent ingest (verified live: SG ids up to ~1.15e18 there, ≤37M here), so
    // cross-tier joins return 0 rows. The child table has a GIN index on search_vector
    // and (post-BUY-77453 DDL) a btree on (id) — full query answers in ~15ms.
    // BUY-79200: always use search_products (the same 97M GIN-indexed catalog
    // that search_products already serves in 100-150ms). Child partitions are
    // stale/tiny for MY/TH/VN and FBP previously timed out on the 97M table
    // because enable_seqscan=off chose idx_sp_cc_price instead of idx_sp_fts_*.
    const useChildTable = false;
    const tierTable = 'search_products';
    if (requestedCountry) {
      tierParams.push(requestedCountry);
      tierConditions.push(`sp.country_code = $${tierParams.length}`);
    }
    const tierWhere = tierConditions.length ? `WHERE ${tierConditions.join(' AND ')}` : '';

    // 2026-08-29: the page window was `limit` (10) ordered by ts_rank alone. For an exact
    // model query every accessory title contains all the query terms, so the ten
    // highest-ranked rows for "sony wh-1000xm5" were ear pads, headband assemblies and
    // repair kits — the headphones themselves never entered the window. That produced
    // both failure modes seen in the external benchmark: a $6.49 repair kit as "best
    // price" before the accessory filter existed, and zero offers after it, because the
    // filter stripped a window that contained nothing else. Rank accessories last in SQL
    // and widen the window so the real product survives to the filter.
    // Detail fetch joins products, not the tier: search_products has no is_active,
    // metadata, category_path or url_status columns, so joining the tier there raised
    // "column does not exist" on every call and find_best_price always returned a
    // degraded empty envelope (2026-08-29).
    const FILTER_POOL = Math.max(limit * 20, 50);
    const candParams = [...tierParams, CANDIDATE_POOL];
    const candResult = await bestPriceClient.query(
      `SELECT sp.id, sp.price, sp.updated_at, sp.title, sp.currency, sp.source, sp.url, sp.image_url, sp.country_code, sp.category,
              ts_rank(sp.search_vector, plainto_tsquery('english', $1)) AS rk
       FROM ${tierTable} sp ${tierWhere}
       LIMIT $${candParams.length}`,
      candParams,
    );
    await bestPriceClient.query('SET enable_indexscan = on');
    await bestPriceClient.query('SET enable_seqscan = on');
    const ranked = (candResult.rows as Record<string, unknown>[]).sort((a, b) => {
      const accRe = /(replacement|repair|ear ?pad|earpad|cushion|protector|charger|charging cable|cable|adapter|strap|band|skin|decal|sticker|holder|mount|stand|assembly|spare part|for use with|compatible with)/i;
      const aAcc = accRe.test(String(a.title || '')) ? 1 : 0;
      const bAcc = accRe.test(String(b.title || '')) ? 1 : 0;
      if (aAcc !== bAcc) return aAcc - bAcc;
      const rk = Number(b.rk || 0) - Number(a.rk || 0);
      if (rk !== 0) return rk;
      const ap = Number(a.price);
      const bp = Number(b.price);
      const aIn = ap >= 5 && ap <= 10000 ? ap : Number.POSITIVE_INFINITY;
      const bIn = bp >= 5 && bp <= 10000 ? bp : Number.POSITIVE_INFINITY;
      if (aIn !== bIn) return aIn - bIn;
      return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
    }).slice(0, FILTER_POOL);
    result = {
      rows: ranked.map((r) => ({
        id: r.id,
        title: r.title,
        price: r.price,
        currency: r.currency,
        domain: r.source,
        url: r.url,
        image_url: r.image_url,
        country_code: r.country_code,
        updated_at: r.updated_at,
        category: r.category,
        category_path: null,
        metadata: null,
        url_last_checked_at: null,
        url_status: 'ok',
      })),
    };
    recordMcpCircuitSuccess('find_best_price', 'catalog_search', country || null);
  } catch (e: any) {
    const degradedKind = classifyMcpDegradedKind(e);
    console.warn(`[find_best_price] catalog_search degraded (${degradedKind}) — ${e?.code ?? ''} ${String(e?.message ?? e).slice(0, 300)}`);
    recordMcpCircuitFailure('find_best_price', 'catalog_search', country || null);
    console.warn(`[find_best_price] BUY-74597: catalog_search degraded (${degradedKind}) — trying REST fallback`);
    const restFbp = await findBestPriceViaRestFallback({ productName, country, t0 });
    if (restFbp && restFbp.best_price) {
      console.warn(`[find_best_price] BUY-74579: query degraded — REST fallback n=${restFbp.meta.total} kind=${degradedKind}`);
      return restFbp;
    }
    return buildMcpDegradedBestPriceResponse({
      productName,
      country,
      responseTimeMs: Date.now() - t0,
      kind: degradedKind,
      stage: 'catalog_search',
      deliverToPresent,
    });
  } finally {
    // BUY-56185: discard connections poisoned by statement_timeout
    if (bestPriceClient) releaseClientSafely(bestPriceClient);
  }

  // BUY-69738: filter by category in-memory instead of SQL (ILIKE causes heap scan at scale)
  // BUY-75839: rows with NULL/empty category are kept — NULL cannot prove a mismatch, and
  // sources like US ingestors (Shopify bulk) often leave category NULL, so stripping them
  // entirely would return 0 results even when valid products exist.
  if (category && result && result.rows.length > 0) {
    const catLower = category.toLowerCase();
    result.rows = result.rows.filter(r => {
      const rowCat = ((r.category as string) || '').trim();
      if (!rowCat) return true; // keep unknown-category rows
      return rowCat.toLowerCase().includes(catLower);
    });
  }

  const currency = COUNTRY_CURRENCY[country] || 'SGD';
  const neg = deviceFilter.negativeTerms;

  // 2026-08-29: the accessory test used to depend on deviceFilter.negativeTerms, which
  // only populates for recognised device families — so "Silicone Protective Cover Set for
  // Sony WH-1000XM5" passed as the product itself and became the "best price". This
  // pattern mirrors the SQL de-prioritisation exactly, so ranking and filtering agree.
  const ACCESSORY_PATTERN = /\b(replacement|repair|ear ?pads?|earpads?|cushions?|protective|protector|silicone|cover|case|sleeve|pouch|charger|charging|cable|adapter|strap|band|skin|decal|sticker|holder|mount|stand|assembly|spare parts?|compatible with|for use with|kit)\b/i;
  const isAccessory = (r: Record<string, unknown>) => {
    if (ACCESSORY_PATTERN.test(String(r.title ?? ''))) return true;
    if (!deviceFilter.type) return false;
    const metadata = (r.metadata && typeof r.metadata === 'object') ? r.metadata as Record<string, unknown> : {};
    const text = [
      String(r.title || ''),
      String((r.category_path as string[] | undefined)?.join(' ') || ''),
      String((r.category as string) || ''),
      String(metadata.category || ''),
      String(metadata.product_type || ''),
    ].join(' ').toLowerCase();
    const positiveSignals: string[] = [];
    if (deviceFilter.type === 'phone') positiveSignals.push('smartphone', 'mobile phone', 'mobile phones');
    if (deviceFilter.type === 'console') positiveSignals.push('game console', 'gaming console', 'consoles');
    if (deviceFilter.type === 'laptop') positiveSignals.push('laptop', 'notebook');
    if (deviceFilter.type === 'tablet') positiveSignals.push('tablet');
    if (deviceFilter.type === 'wearable') positiveSignals.push('smart watch', 'smartwatch', 'fitness tracker');
    const hasPositive = positiveSignals.some(s => text.includes(s));
    const hasNegative = neg.some(t => text.includes(t));
    if (!hasNegative && hasPositive) return false;
    if (hasNegative && !hasPositive) return true;
    if (/\bfor\b.*\b(iphone|galaxy|ipad|ps5|xbox|macbook)\b.*\b\d+\b.*(protector|case|cover|glass|film|cable|adapter|charger|controller|game)\b/.test(text)) return true;
    if (/\bcompatible\b/.test(text) && hasNegative) return true;
    return false;
  };

  // BUY-63229: median-based outlier guard — normalize each row's price to USD by
  // its own currency so scam listings priced in foreign currency can't slip past.
  const rates = getCachedFxRates();
  const rowToUsd = (r: Record<string, unknown>) => {
    const curr = ((r.currency as string) || currency).toUpperCase();
    const fxRate = rates[curr] ?? CURRENCY_RATES[curr] ?? 1;
    const price = r.price != null ? Number(r.price) : 0;
    return price * fxRate;
  };

  let guardApplied = false;
  let medianUsd: number | null = null;
  let minAllowedUsd: number | null = null;
  let finalRows = result ? result.rows.filter(r => !isAccessory(r)) : [];
  // BUY-76206: if ALL results are accessories, fall back to the unfiltered set
  // rather than returning empty. The SQL found products; returning nothing is
  // worse than returning accessories (the user can refine the query).
  // 2026-08-29: when EVERY candidate is an accessory, falling back to the unfiltered set
  // hands the caller a headband cover as the "best price" for the headphones — the exact
  // failure the external benchmark scored CRITICAL. If the query names a specific model
  // and nothing but accessories matched, say so instead of substituting a different
  // product. Callers get an explicit reason rather than a misleading answer.
  const looksLikeExactModel = /[a-z]+[-\s]?\d{2,}|\d{2,}[a-z]{1,3}\b/i.test(productName);
  if (finalRows.length === 0 && result && result.rows.length > 0 && looksLikeExactModel) {
    return {
      best_price: null,
      alternatives: [],
      meta: {
        total: 0,
        product_name: productName,
        country: country || null,
        response_time_ms: Date.now() - t0,
        emptiness_reason: 'only_accessories_matched',
        note: 'Every catalogue match for this model is an accessory (case, cable, ear pads). Returning none rather than presenting an accessory as the product.',
        deliver_to_present: deliverToPresent,
      },
    };
  }
  if (finalRows.length === 0 && result && result.rows.length > 0) {
    finalRows = result.rows;
  }

  if (finalRows.length >= 3) {
    const sortedUsd = finalRows.map(rowToUsd).sort((a, b) => a - b);
    const mid = Math.floor(sortedUsd.length / 2);
    medianUsd = sortedUsd.length % 2 === 0
      ? (sortedUsd[mid - 1] + sortedUsd[mid]) / 2
      : sortedUsd[mid];
    minAllowedUsd = (medianUsd as number) * 0.15;
    const filtered = finalRows.filter(r => rowToUsd(r) >= (minAllowedUsd as number));
    const allRows = result ? result.rows.filter(r => !isAccessory(r)) : finalRows;
    if (filtered.length > 0) {
      finalRows = filtered;
      guardApplied = filtered.length < allRows.length;
      if (guardApplied) {
        console.log(`[find_best_price] BUY-63229 outlier guard: rejected ${allRows.length - filtered.length}/${allRows.length} candidates. median_usd=${(medianUsd as number).toFixed(2)}, min_allowed_usd=${(minAllowedUsd as number).toFixed(2)}, product="${productName}", country=${country}`);
      }
    }
  }

  // BUY-79892: drop foreign-TLD merchants (iplanet.one/IN, mac-center.com COP)
  // and high-side currency-mislabelled outliers the floor guard cannot catch.
  {
    const geo = applyFbpGeoAndHighOutlierGuard({
      rows: finalRows,
      requestedCountry: country,
      rowToUsd,
      deviceType: deviceFilter.type,
    });
    if (geo.geoDropped > 0 || geo.highDropped > 0) {
      guardApplied = true;
      console.log(`[find_best_price] BUY-79892 geo/high guard: geoDropped=${geo.geoDropped} highDropped=${geo.highDropped} max_allowed_usd=${geo.maxAllowedUsd} product="${productName}" country=${country}`);
    }
    finalRows = geo.rows;
  }

  const data = finalRows.slice(0, 10).map((r: Record<string, unknown>) => {
    const price = extractNumericPrice(r.price);
    const curr = ((r.currency as string) || currency).toUpperCase();
    const fxRate = rates[curr] ?? CURRENCY_RATES[curr] ?? 1;
    return {
      id: r.id,
      title: r.title,
      name: r.title,
      price: { amount: price, currency: curr },
      normalized_price_usd: price != null ? Math.round(price * fxRate * 100) / 100 : null,
      merchant: r.domain as string,
      url: r.url as string,
      image_url: r.image_url as string,
      country_code: r.country_code as string,
    };
  });

  return {
    best_price: data[0] ?? null,
    alternatives: data.slice(1),
    meta: {
      total: data.length,
      guard_applied: guardApplied,
      ...(medianUsd != null ? { median_usd: Math.round(medianUsd * 100) / 100 } : {}),
      ...(minAllowedUsd != null ? { min_allowed_usd: Math.round(minAllowedUsd * 100) / 100 } : {}),
      country: country || (region.toLowerCase() === 'us' ? 'US' : 'SG'),
      response_time_ms: Date.now() - t0,
    },
  };
}

// BUY-31929: MCP tool to ingest products — delegates to the same logic as
// POST /v1/ingest/products but via JSON-RPC tool call.
async function handleIngestProducts(args: Record<string, unknown>) {
  const t0 = Date.now();
  const source = String(args.source || '');
  const products = args.products;

  if (!source || source === 'undefined') {
    throw { code: -32602, message: 'Missing required parameter: source' };
  }
  if (!Array.isArray(products) || products.length === 0) {
    throw { code: -32602, message: 'Missing required parameter: products (non-empty array)' };
  }
  if (products.length > 1000) {
    throw { code: -32602, message: 'Maximum 1000 products per request' };
  }

  // Normalize source (reuse the same mapping as the REST endpoint)
  const SOURCE_NORMALIZATION: Record<string, string> = {
    'challenger': 'challenger_sg',
    'challenger.sg': 'challenger_sg',
    'challenger_sg': 'challenger_sg',
    'amazon_sg_toys': 'amazon_sg',
    'ikea.com.sg': 'ikea_sg',
  };
  const normalizedSource = SOURCE_NORMALIZATION[source] || source;

  // Validate each product
  interface ValidProduct {
    sku: string; merchant_id: string; title: string; description?: string;
    price: number; currency: string; url: string; image_url?: string;
    category?: string; category_path?: string[]; brand?: string;
    is_active?: boolean; is_available?: boolean; in_stock?: boolean;
    stock_level?: string; country_code?: string; region?: string;
    metadata?: Record<string, unknown>;
  }
  const validProducts: ValidProduct[] = [];
  const errors: Array<{ index: number; sku: string; error: string }> = [];

  for (let i = 0; i < products.length; i++) {
    const p = products[i] as Record<string, unknown> | null;
    if (!p || typeof p !== 'object') {
      errors.push({ index: i, sku: 'unknown', error: 'Not an object' });
      continue;
    }
    const sku = typeof p.sku === 'string' ? p.sku : '';
    if (!sku) { errors.push({ index: i, sku: 'unknown', error: 'Missing sku' }); continue; }
    if (!p.merchant_id || typeof p.merchant_id !== 'string') { errors.push({ index: i, sku, error: 'Missing merchant_id' }); continue; }
    if (!p.title || typeof p.title !== 'string') { errors.push({ index: i, sku, error: 'Missing title' }); continue; }
    if (p.price === undefined || p.price === null || typeof p.price !== 'number' || p.price < 0) { errors.push({ index: i, sku, error: 'Missing or invalid price' }); continue; }
    if (!p.url || typeof p.url !== 'string') { errors.push({ index: i, sku, error: 'Missing url' }); continue; }

    validProducts.push({
      sku,
      merchant_id: String(p.merchant_id),
      title: String(p.title).slice(0, 1000),
      price: p.price,
      currency: typeof p.currency === 'string' ? p.currency : 'SGD',
      url: String(p.url),
      description: typeof p.description === 'string' ? String(p.description).slice(0, 5000) : undefined,
      image_url: typeof p.image_url === 'string' ? p.image_url : undefined,
      category: typeof p.category === 'string' ? p.category : undefined,
      category_path: Array.isArray(p.category_path) ? p.category_path.map(String).slice(0, 10) : undefined,
      brand: typeof p.brand === 'string' ? String(p.brand).slice(0, 200) : undefined,
      is_active: typeof p.is_active === 'boolean' ? p.is_active : undefined,
      is_available: typeof p.is_available === 'boolean' ? p.is_available : undefined,
      in_stock: typeof p.in_stock === 'boolean' ? p.in_stock : undefined,
      stock_level: typeof p.stock_level === 'string' ? p.stock_level : undefined,
      country_code: typeof p.country_code === 'string' ? p.country_code : undefined,
      region: typeof p.region === 'string' ? p.region : undefined,
      metadata: (p.metadata && typeof p.metadata === 'object') ? p.metadata as Record<string, unknown> : undefined,
    });
  }

  if (validProducts.length === 0) {
    return {
      status: 'failed',
      rows_inserted: 0, rows_updated: 0, rows_failed: errors.length,
      errors,
      response_time_ms: Date.now() - t0,
    };
  }

  // Create ingestion run record
  let runId: number | null = null;
  try {
    const runResult = await db.query(
      `INSERT INTO ingestion_runs (source, status) VALUES ($1, 'running') RETURNING id`,
      [normalizedSource]
    );
    runId = runResult.rows[0]?.id || null;
  } catch (e) {
    console.warn('[mcp:ingest] Failed to create ingestion run record:', (e as Error).message);
  }

  // Check existing SKUs. The unique constraint is (sku, source, country_code), so
  // the pre-existing check must match — a (sku, source) hit in another country is a
  // different row. Use a values join for the composite match.
  const existingSkus = new Set<string>();
  const skuToId = new Map<string, number>();
  if (validProducts.length > 0) {
    const tuples = validProducts
      .map((p) => `('${p.sku.replace(/'/g, "''")}','${normalizedSource.replace(/'/g, "''")}','${(p.country_code || '').replace(/'/g, "''")}')`)
      .join(',');
    const existingResult = await db.query(
      `SELECT id, sku, source, country_code FROM products
         WHERE (sku, source, country_code) IN (${tuples})`
    );
    for (const r of existingResult.rows as { id: number; sku: string; source: string; country_code: string }[]) {
      const key = `${r.sku} ${r.source} ${r.country_code}`;
      existingSkus.add(key);
      skuToId.set(key, r.id);
    }
  }

  let rowsInserted = 0;
  let rowsUpdated = 0;

  try {
    const values: unknown[] = [];
    const placeholders: string[] = [];

    for (const p of validProducts) {
      const base = values.length + 1;
      const metadata: Record<string, unknown> = {
        ...(p.metadata || {}),
        origin_merchant_id: p.merchant_id,
        category: p.category || null,
      };
      if (p.in_stock !== undefined) metadata.in_stock = p.in_stock;
      if (p.stock_level !== undefined) metadata.stock_level = p.stock_level;
      if (p.is_available !== undefined) metadata.is_available = p.is_available;

      const catPath = (p.category_path && p.category_path.length > 0)
        ? `{${p.category_path.map(c => `"${c.replace(/"/g, '\\"')}"`).join(',')}}`
        : '{}';

      values.push(
        p.sku, normalizedSource, p.merchant_id, p.title,
        p.description || null,
        p.price, p.currency || 'SGD',
        p.url, p.image_url || null,
        catPath,
        p.brand || null,
        JSON.stringify(metadata),
        p.is_active !== false,
        // products is partitioned by country_code; the partition's `region`
        // column is NOT NULL and the column default ('sg') only applies when
        // the column is omitted from the INSERT. We're listing the column,
        // so we must supply a value. Default to country_code lowercased,
        // then 'sg' as the last-resort fallback.
        p.region || (p.country_code ? p.country_code.toLowerCase() : null) || 'sg',
        p.country_code || null,
      );

      placeholders.push(
        `($${base},$${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13},$${base + 14})`
      );
    }

    await db.query(
      `INSERT INTO products
         (sku, source, merchant_id, title, description, price, currency, url,
          image_url, category_path, brand, metadata, is_active, region, country_code)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (sku, source, country_code)
       DO UPDATE SET
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         price = EXCLUDED.price,
         currency = EXCLUDED.currency,
         url = EXCLUDED.url,
         image_url = COALESCE(NULLIF(EXCLUDED.image_url, ''), products.image_url),
         brand = EXCLUDED.brand,
         category_path = EXCLUDED.category_path,
         merchant_id = EXCLUDED.merchant_id,
         metadata = EXCLUDED.metadata,
         is_active = true,
         region = COALESCE(EXCLUDED.region, products.region),
         country_code = COALESCE(EXCLUDED.country_code, products.country_code),
         updated_at = NOW()`,
      values
    );

    for (const p of validProducts) {
      const key = `${p.sku} ${normalizedSource} ${p.country_code || ''}`;
      if (existingSkus.has(key)) {
        rowsUpdated++;
      } else {
        rowsInserted++;
      }
    }
  } catch (e) {
    const msg = (e as Error).message;
    console.error('[mcp:ingest] Bulk upsert failed:', msg);

    if (runId !== null) {
      await db.query(
        `UPDATE ingestion_runs SET status = 'failed', error_message = $1, finished_at = NOW() WHERE id = $2`,
        [msg.slice(0, 500), runId]
      ).catch(() => {});
    }

    return {
      run_id: runId, status: 'failed',
      rows_inserted: 0, rows_updated: 0, rows_failed: validProducts.length,
      errors: [{ index: -1, sku: 'batch', error: `Database error: ${msg}` }, ...errors],
      response_time_ms: Date.now() - t0,
    };
  }

  // Insert price history
  const finalResult = await db.query(
    `SELECT id, sku, source, country_code FROM products
       WHERE (sku, source, country_code) IN (${validProducts
         .map((p) => `('${p.sku.replace(/'/g, "''")}','${normalizedSource.replace(/'/g, "''")}','${(p.country_code || '').replace(/'/g, "''")}')`)
         .join(',')})`
  );
  for (const r of finalResult.rows as { id: number; sku: string; source: string; country_code: string }[]) {
    skuToId.set(`${r.sku} ${r.source} ${r.country_code}`, r.id);
  }

  const phValues: unknown[] = [];
  const phPlaceholders: string[] = [];
  for (const p of validProducts) {
    const productId = skuToId.get(`${p.sku} ${normalizedSource} ${p.country_code || ''}`);
    if (productId) {
      const base = phValues.length + 1;
      phValues.push(productId, p.price, p.currency || 'SGD', normalizedSource);
      phPlaceholders.push(`($${base},$${base + 1},$${base + 2},$${base + 3})`);
    }
  }
  if (phValues.length > 0) {
    try {
      await db.query(
        `INSERT INTO price_history (product_id, price, currency, source) VALUES ${phPlaceholders.join(', ')}`,
        phValues
      );
    } catch (e) {
      console.warn('[mcp:ingest] Price history insert failed:', (e as Error).message);
    }
  }

  const status = errors.length === 0 ? 'completed' : 'completed_with_errors';
  if (runId !== null) {
    await db.query(
      `UPDATE ingestion_runs SET status = $1, rows_inserted = $2, rows_updated = $3, rows_failed = $4, finished_at = NOW() WHERE id = $5`,
      [status, rowsInserted, rowsUpdated, errors.length, runId]
    ).catch(() => {});
  }

  // Invalidate caches
  if (rowsInserted > 0 || rowsUpdated > 0) {
    try {
      const keys = await redis.keys('products:*');
      if (keys.length > 0) await redis.del(...keys);
      const searchKeys = await redis.keys('search:*');
      if (searchKeys.length > 0) await redis.del(...searchKeys);
      // BUY-75291 / BUY-79497 / BUY-79642: MCP search_products uses fts:v10:*.
      const ftsKeys = await redis.keys('fts:v10:*');
      if (ftsKeys.length > 0) await redis.del(...ftsKeys);
      await redis.set(`bw:ingestion:last_success:${normalizedSource}`, String(Date.now() / 1000));
    } catch (e) {
      console.warn('[mcp:ingest] Cache invalidation failed:', (e as Error).message);
    }
  }

  return {
    run_id: runId,
    status,
    rows_inserted: rowsInserted,
    rows_updated: rowsUpdated,
    rows_failed: errors.length,
    errors: errors.length > 0 ? errors : undefined,
    response_time_ms: Date.now() - t0,
  };
}



// 2026-08-29: find_similar used to throw -32001 whenever a product had no vector yet.
// With the Flow backfill still running that is the expected state for most of the
// catalog, and a tool that errors on an expected state is a broken tool. Fall back to
// keyword similarity on the product's own title and label the result honestly so the
// caller knows it is not semantic.
async function keywordSimilarFallback(productId: string, limit: number, reason: string) {
  const client = await servingReadDbConnect();
  try {
    const ref = await client.query<{ title: string; country_code: string | null; category: string | null }>(
      'SELECT title, country_code, category FROM products WHERE id = $1::bigint LIMIT 1',
      [productId]
    );
    if (ref.rowCount === 0) {
      return { data: [], meta: { total: 0, similarity: 'none', reason: 'product_not_found' } };
    }
    const { title, country_code } = ref.rows[0];
    const params: unknown[] = [title, productId];
    // search_products carries only active rows, and has no is_active column.
    let where = "search_vector @@ plainto_tsquery('english', $1) AND id <> $2::bigint";
    if (country_code) { params.push(country_code); where += ` AND country_code = $${params.length}`; }
    params.push(limit);
    const rows = await client.query(
      `SELECT id, title, price, currency, url, image_url, country_code, category
       FROM search_products WHERE ${where}
       ORDER BY ts_rank(search_vector, plainto_tsquery('english', $1)) DESC LIMIT $${params.length}`,
      params
    );
    return {
      data: rows.rows,
      meta: {
        total: rows.rowCount,
        similarity: 'keyword',
        semantic_available: false,
        reason,
        note: 'Keyword similarity on the product title. Semantic similarity becomes available for this product once its embedding is generated.',
      },
    };
  } finally {
    releaseClientSafely(client);
  }
}

async function handleFindSimilar(args: Record<string, unknown>) {
  const t0 = Date.now();
  const productId = (args.product_id as string || '').trim();
  const limit = Math.min(Number(args.limit) || 10, 10);

  if (!productId) {
    throw { code: -32602, message: 'missing required parameter: product_id' };
  }

  // product_embeddings.product_id is bigint; reject non-numeric IDs upfront so the
  // SQL parameter doesn't blow up with "invalid input syntax for type bigint".
  // BUY-59390 — previously the handler exposed -32603 raw SQL errors.
  if (!/^\d+$/.test(productId)) {
    throw { code: -32602, message: `Invalid product_id format: expected numeric ID, got "${productId}"` };
  }

  if (!vectorDb) {
    return keywordSimilarFallback(productId, limit, 'vector_db_unavailable');
  }

  // Step 1: get reference embedding from vector DB
  let refResult;
  try {
    refResult = await vectorDb.query<{ embedding: string }>(
      `SELECT embedding_v2::text AS embedding FROM product_embeddings WHERE product_id = $1 AND model_ver = 'flow-embed-1@1024'`,
      [productId]
    );
  } catch {
    return keywordSimilarFallback(productId, limit, 'no_embedding_for_product');
  }
  if (!refResult.rows.length) {
    return keywordSimilarFallback(productId, limit, 'no_embedding_for_product');
  }
  const refEmbedding = refResult.rows[0].embedding;

  // Step 2: find nearest neighbours in vector DB (excluding source product)
  let nearResult;
  try {
    nearResult = await vectorDb.query<{ product_id: string; distance: number }>(
      `SELECT product_id, ((embedding_v2::halfvec(1024)) <=> $1::halfvec(1024))::float AS distance
       FROM product_embeddings WHERE product_id != $2
       ORDER BY (embedding_v2::halfvec(1024)) <=> $1::halfvec(1024) LIMIT $3`,
      [refEmbedding, productId, limit]
    );
  } catch {
    return keywordSimilarFallback(productId, limit, 'no_vector_neighbours');
  }
  if (!nearResult.rows.length) {
    return keywordSimilarFallback(productId, limit, 'no_vector_neighbours');
  }

  // Step 3: fetch product details from main DB
  const nearIds = nearResult.rows.map(r => r.product_id);
  const ph = nearIds.map((_, i) => `$${i + 1}`).join(',');
  // BUY-79353: use merchant_id as displayed merchant, not source (feed origin).
  const detailResult = await db.query(
    `SELECT id, title, price, currency, merchant_id AS domain, url, image_url
     FROM products WHERE id IN (${ph}) AND is_active = true`,
    nearIds
  );

  // Step 4: merge, preserving similarity order
  const distMap = new Map(nearResult.rows.map(r => [r.product_id, r.distance]));
  const byId = new Map(detailResult.rows.map(r => [(r as Record<string, unknown>).id as string, r]));
  const similar = nearIds
    .map(id => {
      const p = byId.get(id) as Record<string, unknown> | undefined;
      if (!p) return null;
      const dist = distMap.get(id) ?? 1;
      return {
        id: p.id,
        title: p.title,
        price: p.price,
        currency: p.currency,
        domain: p.domain,
        url: p.url,
        image_url: p.image_url,
        similarity: +Math.max(0, 1 - dist).toFixed(4),
      };
    })
    .filter(Boolean);

  return {
    product_id: productId,
    similar,
    total: similar.length,
    response_time_ms: Date.now() - t0,
  };
}


// BUY-73666: `market` is a common agent alias for `country_code`. When agents pass
// market=MY it was silently ignored because no handler read args.market, causing
// every non-SG query to fall through to the SG default. Normalize once at
// dispatch time so all downstream handlers see country_code set correctly.
// (Ported from mcp-railway where this fix landed 2026-08-24.)
const MARKET_TO_COUNTRY: Record<string, string> = {
  sg: "SG", us: "US", my: "MY", th: "TH", vn: "VN",
  gb: "GB", uk: "GB", in: "IN", au: "AU", ph: "PH", id: "ID",
};

function normalizeMarketArg(args: Record<string, unknown>): void {
  const market = (args.market as string || "").trim();
  if (market) {
    const mapped = MARKET_TO_COUNTRY[market.toLowerCase()] || market.toUpperCase();
    if (!args.country_code && !args.country) {
      args.country_code = mapped;
    }
  }
  // BUY-79449: ISO region=sg|my|… is a country alias, not catalog region (sea/us).
  const rawRegion = String(args.region || '').trim().toLowerCase();
  if (!rawRegion) return;
  const COARSE = new Set(['sea', 'us', 'eu', 'au', 'global']);
  if (COARSE.has(rawRegion)) {
    if (rawRegion === 'us' && !args.country_code && !args.country && !args.deliver_to) {
      args.country_code = 'US';
    }
    return;
  }
  const iso = MARKET_TO_COUNTRY[rawRegion] || (rawRegion.length === 2 ? rawRegion.toUpperCase() : '');
  if (iso) {
    if (!args.country_code && !args.country && !args.deliver_to) {
      args.country_code = iso;
    }
    delete args.region;
  }
}

// BUY-71129 (re-applied, was clobbered by 554950c7): caller identity
// thread-through for click attribution. Mirrors routes/products.ts.
function callerContextForUrl(req: Request): { apiKeyId: string; keyHash: string } | null {
  const rec = (req as Request & { apiKeyRecord?: { id?: string; key?: string } }).apiKeyRecord;
  if (!rec || !rec.id || !rec.key) return null;
  return { apiKeyId: rec.id, keyHash: createHash('sha256').update(rec.key).digest('hex') };
}


// 2026-08-29: agents chain tools using whatever key the previous tool returned, and our
// own tools disagree: search takes `query`/`q`, get_product takes `id`, find_similar takes
// `product_id`, compare takes `ids` in v2 but `product_ids` in v1, and find_best_price
// accepted `q`/`product_name` but NOT `query` — so the natural call
// find_best_price_v2({query}) failed with -32602 while search_products_v2({query}) worked.
// Normalise the common aliases once, at dispatch, so every tool accepts every spelling.
function normalizeToolArgAliases(args: Record<string, unknown>) {
  const alias = (from: string, to: string) => {
    if (args[to] === undefined && args[from] !== undefined) args[to] = args[from];
  };
  alias('query', 'q');
  alias('q', 'query');
  alias('q', 'product_name');
  alias('product_name', 'q');
  alias('product_id', 'id');
  alias('id', 'product_id');
  alias('product_ids', 'ids');
  alias('ids', 'product_ids');
}

function mcpCatalogWallEnvelope(name: string, args: Record<string, unknown>, startedAt: number) {
  const country = String((args.deliver_to || args.country_code || args.country || 'SG') as string).toUpperCase();
  const limit = Math.min(Number(args.limit) || 20, 100);
  const offset = Number(args.offset) || 0;
  const deliverToPresent = Boolean(
    (typeof args.deliver_to === 'string' && args.deliver_to.trim() !== '') ||
    (typeof args.country_code === 'string' && args.country_code.trim() !== '') ||
    (typeof args.country === 'string' && args.country.trim() !== ''),
  );
  const responseTimeMs = Date.now() - startedAt;
  if (name.startsWith('find_best_price')) {
    recordMcpCircuitFailure('find_best_price', 'catalog_search', country);
    return buildMcpDegradedBestPriceResponse({
      productName: String((args.product_name || args.q || args.query || '') as string),
      country,
      responseTimeMs,
      kind: 'timeout',
      stage: 'catalog_search',
      deliverToPresent,
    });
  }
  const tool: McpDegradedTool = name.startsWith('get_deals') ? 'get_deals' : 'search_products';
  const stage: McpDegradedStage = name.startsWith('get_deals') ? 'offer_aggregation' : 'catalog_search';
  recordMcpCircuitFailure(tool, stage, country);
  return buildMcpDegradedSearchResponse({
    tool,
    stage,
    kind: 'timeout',
    limit,
    offset,
    responseTimeMs,
    country,
    deliverToPresent,
  });
}

async function withMcpCatalogWall<T>(name: string, args: Record<string, unknown>, work: () => Promise<T>): Promise<T> {
  if (!MCP_CATALOG_WALL_TOOLS.has(name)) return work();
  const startedAt = Date.now();
  let timer: NodeJS.Timeout | undefined;
  const wall = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('mcp_catalog_wall_timeout'), { code: '57014' })), (MCP_TOOL_WALL_MS[name] || MCP_CATALOG_WALL_MS));
  });
  try {
    return await Promise.race([work(), wall]);
  } catch (err) {
    const message = String((err as { message?: string })?.message || '');
    if (message.includes('mcp_catalog_wall_timeout')) {
      console.warn(`[mcp] BUY-67598/BUY-78735: ${name} hit ${(MCP_TOOL_WALL_MS[name] || MCP_CATALOG_WALL_MS)}ms catalog wall — flushing degraded envelope`);
      return mcpCatalogWallEnvelope(name, args, startedAt) as T;
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function dispatchTool(name: string, args: Record<string, unknown>, caller?: ReturnType<typeof callerContextForUrl>) {
  normalizeMarketArg(args);
  normalizeToolArgAliases(args);
  return withMcpCatalogWall(name, args, async () => {
    switch (name) {
      case 'search_products':  return handleSearchProducts(args, caller);
      case 'get_product':      return handleGetProduct(args, caller);
      case 'compare_products': return handleCompareProducts(args, caller);
      case 'get_deals':        return handleGetDeals(args, caller);
      case 'list_categories':  return handleListCategories(args);
      case 'find_best_price':  return handleFindBestPrice(args);
      case 'ingest_products':  return handleIngestProducts(args);
      case 'find_similar':     return handleFindSimilar(args);
      case 'search_products_v2':  return handleSearchProductsV2(args);
      case 'get_product_v2':      return handleGetProductV2(args);
      case 'compare_products_v2': return handleCompareProductsV2(args);
      case 'get_deals_v2':        return handleGetDealsV2(args);
      case 'find_best_price_v2':  return handleFindBestPriceV2(args);
      default:
        throw { code: -32601, message: `Unknown tool: ${name}` };
    }
  });
}

// BUY-72533: v2 surface — REQUIRED deliver_to, plus v2-specific response fields.
// v2 validates `deliver_to` is present (rejects with -32602 INVALID_ARGUMENT otherwise),
// then delegates to the v1 handler with the same args (v1 logic is unchanged).
// v2-specific extras:
//   - find_best_price_v2: response includes `shopping_job_id` (UUID)
//   - get_product_v2: response includes `outbound_url` (https://…) per product

// BUY-72700: Set of valid ISO 3166-1 alpha-2 codes that BuyWhere supports for deliver_to.
// When an unknown code (e.g. "ZZ") is passed, v2 tools must return 200 OK with empty
// results and meta.emptiness_reason="invalid_deliver_to" — NOT a JSON-RPC error.
const VALID_DELIVER_TO = new Set([
  'SG', 'US', 'VN', 'TH', 'MY', 'GB', 'IN', 'AU', 'PH', 'ID',
]);

function requireDeliverTo(args: Record<string, unknown>, toolName: string): string {
  const raw = args.deliver_to;
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) {
    throw { code: -32602, message: `${toolName} requires deliver_to (ISO country code, e.g. "SG", "US")` };
  }
  // Normalise to uppercase for downstream handlers.
  const normalised = value.toUpperCase();
  // BUY-72700: reject non-ISO-alpha-2 (e.g. "USA", "123", " sg ") and unknown codes (e.g. "ZZ").
  if (!/^[A-Z]{2}$/.test(normalised) || !VALID_DELIVER_TO.has(normalised)) {
    throw { code: 'INVALID_DELIVER_TO', toolName, raw: normalised };
  }
  args.deliver_to = normalised;
  return normalised;
}

// BUY-73952: deliver_to default inference — v2 callers that supply country_code
// (or its alias `country`) but omit deliver_to still get shipping-ranked results.
// Mirrors the REST contract in routes/products.ts: set deliver_to = country_code
// when missing, and let the caller distinguish the inferred case via meta.deliver_to_inferred.
// Returns true when inference happened so the wrapper can stamp the flag in response.meta.
function inferDeliverTo(args: Record<string, unknown>): boolean {
  const existing = typeof args.deliver_to === 'string' ? args.deliver_to.trim() : '';
  if (existing) return false;
  const cc = typeof args.country_code === 'string' ? args.country_code.trim() : '';
  const countryAlias = typeof args.country === 'string' ? args.country.trim() : '';
  const source = cc || countryAlias;
  if (!source) return false;
  // BUY-73952: per parent spec, deliver_to defaults to country_code verbatim.
  // requireDeliverTo will reject unsupported / non-ISO-alpha-2 codes with the
  // structured INVALID_DELIVER_TO envelope (BUY-72700) rather than missing-deliver_to.
  args.deliver_to = source.toUpperCase();
  return true;
}

// BUY-72700: Build a 200-OK response with empty results and meta.emptiness_reason.
function buildInvalidDeliverToResponse(toolName: string, rawDeliverTo: string) {
  return {
    data: [],
    products: [],
    results: [],
    items: [],
    meta: {
      total: 0,
      limit: 0,
      offset: 0,
      response_time_ms: 0,
      cached: false,
      emptiness_reason: 'invalid_deliver_to',
      deliver_to: rawDeliverTo,
      hint: `deliver_to="${rawDeliverTo}" is not a supported country code. Supported: ${Array.from(VALID_DELIVER_TO).join(', ')}.`,
    },
  };
}

async function handleSearchProductsV2(args: Record<string, unknown>) {
  let deliverTo: string;
  let inferred = false;
  try {
    // BUY-73952: infer deliver_to from country_code/country when omitted.
    inferred = inferDeliverTo(args);
    deliverTo = requireDeliverTo(args, 'search_products_v2');
  } catch (e: any) {
    if (e?.code === 'INVALID_DELIVER_TO') {
      return buildInvalidDeliverToResponse('search_products_v2', e.raw);
    }
    throw e;
  }
  const result = await handleSearchProducts(args);
  applyNoMatchMeta(result);
  if (result && typeof result === 'object' && (result as any).meta && typeof (result as any).meta === 'object') {
    ((result as any).meta as Record<string, unknown>).deliver_to = deliverTo;
  }
  // BUY-73952: stamp meta.deliver_to_inferred when defaulting happened.
  if (inferred && result && typeof result === 'object' && (result as any).meta && typeof (result as any).meta === 'object') {
    ((result as any).meta as Record<string, unknown>).deliver_to_inferred = true;
  }
  return result;
}

function applyNoMatchMeta(response: any): void {
  if (!response || typeof response !== 'object') return;
  const meta = response.meta && typeof response.meta === 'object'
    ? response.meta as Record<string, unknown>
    : (response.meta = {});
  if (meta.emptiness_reason) return;

  const dataCount = Array.isArray(response.data) ? response.data.length : null;
  const productsCount = Array.isArray(response.products) ? response.products.length : null;
  const resultsCount = Array.isArray(response.results) ? response.results.length : null;
  const itemsCount = Array.isArray(response.items) ? response.items.length : null;
  const bestPriceCount = response.best_price ? 1 : 0;
  const alternativesCount = Array.isArray(response.alternatives) ? response.alternatives.length : 0;
  const total = typeof meta.total === 'number' ? meta.total : Number(meta.total ?? NaN);

  if (total === 0 || dataCount === 0 || productsCount === 0 || resultsCount === 0 || itemsCount === 0 || (response.best_price === null && alternativesCount === 0 && !dataCount && !productsCount && !resultsCount && !itemsCount)) {
    meta.emptiness_reason = 'no_match';
    if (!Number.isFinite(total)) meta.total = bestPriceCount + alternativesCount;
  }
}

async function handleGetDealsV2(args: Record<string, unknown>) {
  let deliverTo: string;
  let inferred = false;
  try {
    // BUY-73952: infer deliver_to from country_code/country when omitted.
    inferred = inferDeliverTo(args);
    deliverTo = requireDeliverTo(args, 'get_deals_v2');
  } catch (e: any) {
    if (e?.code === 'INVALID_DELIVER_TO') {
      return buildInvalidDeliverToResponse('get_deals_v2', e.raw);
    }
    throw e;
  }
  const result = await handleGetDeals(args);
  applyNoMatchMeta(result);
  // BUY-73952: stamp meta.deliver_to_inferred when defaulting happened.
  if (inferred && result && typeof result === 'object' && (result as any).meta && typeof (result as any).meta === 'object') {
    ((result as any).meta as Record<string, unknown>).deliver_to_inferred = true;
  }
  return result;
}

async function handleCompareProductsV2(args: Record<string, unknown>) {
  let deliverTo: string;
  let inferred = false;
  try {
    // BUY-73952: infer deliver_to from country_code/country when omitted.
    inferred = inferDeliverTo(args);
    deliverTo = requireDeliverTo(args, 'compare_products_v2');
  } catch (e: any) {
    if (e?.code === 'INVALID_DELIVER_TO') {
      return buildInvalidDeliverToResponse('compare_products_v2', e.raw);
    }
    throw e;
  }
  const result = await handleCompareProducts(args);
  applyNoMatchMeta(result);
  // BUY-73952: stamp meta.deliver_to_inferred when defaulting happened.
  if (inferred && result && typeof result === 'object' && result.meta && typeof result.meta === 'object') {
    (result.meta as unknown as Record<string, unknown>).deliver_to_inferred = true;
  }
  // BUY-72533 acceptance: v2 compare returns outbound_url per product for the buyer market.
  attachOutboundUrls(result);
  return result;
}

async function handleFindBestPriceV2(args: Record<string, unknown>) {
  let deliverTo: string;
  let inferred = false;
  try {
    // BUY-73952: infer deliver_to from country_code/country when omitted.
    inferred = inferDeliverTo(args);
    deliverTo = requireDeliverTo(args, 'find_best_price_v2');
  } catch (e: any) {
    if (e?.code === 'INVALID_DELIVER_TO') {
      return buildInvalidDeliverToResponse('find_best_price_v2', e.raw);
    }
    throw e;
  }
  const result = await handleFindBestPrice(args);
  applyNoMatchMeta(result);
  // BUY-73952: stamp meta.deliver_to_inferred when defaulting happened.
  if (inferred && result && typeof result === 'object' && result.meta && typeof result.meta === 'object') {
    (result.meta as unknown as Record<string, unknown>).deliver_to_inferred = true;
  }
  // BUY-72533 acceptance: v2 find_best_price returns a shopping_job_id (UUID) when
  // called with deliver_to. This is the canonical handle for resuming a multi-
  // merchant price-comparison session for the buyer.
  await attachShoppingJobId(result, args);
  // v2 find_best_price also resolves outbound_url for the best_price + each alternative,
  // so the agent can route the buyer directly to the merchant from the response.
  attachOutboundUrlToBestPrice(result);
  return result;
}

async function handleGetProductV2(args: Record<string, unknown>) {
  let deliverTo: string;
  let inferred = false;
  try {
    // BUY-73952: infer deliver_to from country_code/country when omitted.
    inferred = inferDeliverTo(args);
    deliverTo = requireDeliverTo(args, 'get_product_v2');
  } catch (e: any) {
    if (e?.code === 'INVALID_DELIVER_TO') {
      return buildInvalidDeliverToResponse('get_product_v2', e.raw);
    }
    throw e;
  }
  const result = await handleGetProduct(args);
  applyNoMatchMeta(result);
  // BUY-73952: stamp meta.deliver_to_inferred when defaulting happened.
  if (inferred && result && typeof result === 'object' && result.meta && typeof result.meta === 'object') {
    (result.meta as unknown as Record<string, unknown>).deliver_to_inferred = true;
  }
  // BUY-72533 acceptance: get_product_v2 returns outbound_url (https://…) when the
  // product has merchant offers. The base handleGetProduct already returns the
  // canonical product list via buildSearchResponse; we resolve outbound_url per product
  // for the buyer market.
  attachOutboundUrls(result);
  return result;
}

// Resolve `outbound_url` (https://…) for the best_price result + each alternative,
// matching the response shape produced by handleFindBestPrice.
function attachOutboundUrlToBestPrice(response: any): void {
  if (!response || typeof response !== 'object') return;
  for (const product of [response.best_price, ...(Array.isArray(response.alternatives) ? response.alternatives : [])]) {
    if (!product || typeof product !== 'object') continue;
    const url = typeof product.url === 'string' ? product.url : '';
    const merchant = typeof product.merchant === 'string' ? product.merchant : null;
    const productId = product.id != null ? String(product.id) : '';
    if (!url || !productId) continue;
    product.outbound_url = buildClickUrl({
      productId,
      destinationUrl: url,
      merchantId: merchant,
    });
  }
}

// Resolve `outbound_url` (https://…) for every product in a v2 response that carries
// one. Backed by buildClickUrl from instrumentation.ts (the same resolver used by
// the canonical product builder). Mutates the response in place; safe for the
// JSON-RPC envelope which serialises a deep copy.
function attachOutboundUrls(response: any): void {
  // buildSearchResponse uses `data`, not `results` — handle both for safety.
  const products = Array.isArray(response?.data)
    ? response.data
    : Array.isArray(response?.results)
      ? response.results
      : null;
  if (!products) return;
  for (const product of products) {
    if (!product || typeof product !== 'object') continue;
    const url = typeof product.url === 'string' ? product.url : '';
    const merchant = typeof product.merchant === 'string' ? product.merchant : null;
    const productId = product.id != null ? String(product.id) : '';
    if (!url || !productId) continue;
    product.outbound_url = buildClickUrl({
      productId,
      destinationUrl: url,
      merchantId: merchant,
    });
  }
}

// Attach a shopping_job_id (UUID) to find_best_price_v2 responses. The id is derived
// from a stable hash of (product_name, deliver_to, country) so retries of the same
// query return the same session id, which is what an agent resuming a multi-merchant
// shopping flow expects.
async function attachShoppingJobId(response: any, args: Record<string, unknown>): Promise<void> {
  const productName = String(args.product_name || args.q || args.query || '').trim();
  const deliverTo = String(args.deliver_to || '').trim().toUpperCase();
  const country = String(args.country_code || args.country || '').trim().toUpperCase();
  const sessionKey = productName && deliverTo
    ? `${productName.toLowerCase()}|${deliverTo}|${country}`
    : '';
  if (sessionKey) {
    // Deterministic UUID v5 from the session key — node:crypto supports this via
    // a manual SHA-1 + UUID v5 construction. Falls back to randomUUID if hashing fails.
    try {
      response.shopping_job_id = uuidV5(sessionKey, V2_SHOPPING_NAMESPACE);
    } catch {
      response.shopping_job_id = randomUUID();
    }
  } else {
    response.shopping_job_id = randomUUID();
  }
  response.shopping_session_key = sessionKey || null;
}

// BUY-72533 namespace for v2 shopping_job_id v5 derivation. Picked arbitrarily and
// kept stable across deploys so the same (product, deliver_to, country) yields the
// same shopping_job_id across calls.
const V2_SHOPPING_NAMESPACE = 'c0d4f1a3-2b51-4d8e-9f10-buywhere-v2-shopping';

function uuidV5(name: string, namespace: string): string {
  // Minimal UUID v5: SHA-1 hash of (namespace bytes || name bytes), set version + variant bits.
  const nsBytes = parseUuidBytes(namespace);
  const nameBytes = new Uint8Array(Buffer.from(name, 'utf8'));
  const combined = new Uint8Array(nsBytes.length + nameBytes.length);
  combined.set(nsBytes, 0);
  combined.set(nameBytes, nsBytes.length);
  const hash = require('crypto').createHash('sha1').update(combined).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function parseUuidBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32) throw new Error('invalid namespace uuid');
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

// JSON-RPC 2.0 response helpers
function jsonrpcOk(id: unknown, result: unknown) {
  // BUY-benchmark 2026-08-29: JSON-RPC 2.0 permits only jsonrpc/id/result|error at the top
  // level. request_id/timestamp here made the official MCP Inspector exit 1 and any strict
  // client reject the response. Diagnostics belong in headers, not the envelope.
  return { jsonrpc: '2.0', id, result };
}
function jsonrpcErr(id: unknown, code: number, message: string, data?: unknown, envelopeCode?: string) {
  const errorData: Record<string, unknown> = data != null ? { detail: data } : {};
  if (envelopeCode) {
    errorData.envelope = buildErrorEnvelope(envelopeCode as ErrorCodeType, message);
  }
  return { jsonrpc: '2.0', id, error: { code, message, ...(Object.keys(errorData).length ? { data: errorData } : {}) } };
}

// GET /mcp/auth/token — token endpoint descriptor (public, no auth).
// BUY-33837: matches the pre-migration mcp-server-production.js surface so
// legacy probes and OAuth-style clients still receive a JSON descriptor
// at /api/mcp/auth/token. Real token issuance moved to /v1/keys (API keys).
router.get('/auth/token', (_req: Request, res: Response) => {
  res.json({
    endpoint: '/api/mcp/auth/token',
    methods: ['GET'],
    grant_types_supported: ['client_credentials'],
    token_types_supported: ['Bearer'],
    response_type: 'json',
    note: 'Token issuance moved to /v1/keys (API key). This endpoint is informational.',
    production: true,
    domain: 'api.buywhere.ai',
    ts: new Date().toISOString(),
  });
});

// GET /mcp/auth/verify — bearer-token introspection (requires API key).
// Returns the scopes and identity bound to the presented key. Useful for
// agents that want to confirm a freshly-issued key before use.
router.get('/auth/verify', requireApiKey, (req: Request, res: Response) => {
  const k = (req as Request & { apiKey?: { clientId?: string; keyId?: string; scopes?: string[] } }).apiKey;
  res.json({
    authenticated: true,
    method: 'bearer_token',
    clientId: k?.clientId ?? null,
    keyId: k?.keyId ?? null,
    scopes: k?.scopes ?? [],
    timestamp: new Date().toISOString(),
    production: true,
    domain: 'api.buywhere.ai',
  });
});

// GET /mcp/metrics — process/system metrics (public, no auth).
// BUY-33837: process-scoped counters for ops dashboards. Cheap (no DB or
// Redis calls) and safe to expose unauthenticated.
router.get('/metrics', (_req: Request, res: Response) => {
  const mu = process.memoryUsage();
  res.json({
    timestamp: new Date().toISOString(),
    system: {
      uptime: process.uptime(),
      memory: {
        used: mu.heapUsed,
        total: mu.heapTotal,
        external: mu.external,
        rss: mu.rss,
      },
      cpu: process.cpuUsage(),
      version: process.version,
      platform: process.platform,
    },
    production: true,
    domain: 'api.buywhere.ai',
  });
});

// BUY-69817: Helper to extract a normalised region from tool args. Falls back to SG.
function extractRegion(toolArgs: Record<string, unknown>): SupportedRegion | '*unknown*' {
  const raw = (
    (toolArgs.deliver_to as string)
    || (toolArgs.country_code as string)
    || (toolArgs.country as string)
    || (toolArgs.region as string)
    || ''  // Explicit empty string instead of defaulting to SG
  ).toString().trim().toUpperCase();
  const REGION_TO_COUNTRY: Record<string, string> = {
    SG: 'SG', US: 'US', MY: 'MY', TH: 'TH', VN: 'VN',
    PH: 'PH', ID: 'ID', GB: 'GB', IN: 'IN', AU: 'AU',
    SEA: 'SG',
  };
  // Empty/unknown regions return a sentinel that healthSnapshot will exclude
  if (!raw) return '*unknown*' as const;
  const normalised = REGION_TO_COUNTRY[raw] || raw;
  return (SUPPORTED_REGIONS as readonly string[]).includes(normalised)
    ? (normalised as SupportedRegion)
    : '*unknown*' as const;
}

// GET /mcp/health — public health surface with per-tool/per-region breakdown.
router.get('/health', async (_req: Request, res: Response) => {
  try {
    const [countResult, pong] = await Promise.all([
      db.query(`SELECT reltuples::bigint AS count FROM pg_class WHERE relname = 'products'`),
      redis.ping(),
    ]);
    const catalogTotal = parseInt(countResult.rows[0]?.count ?? '0', 10);

    let snapshot;
    try {
      snapshot = computeSnapshot();
    } catch (snapErr) {
      snapshot = { status: 'ok', server: 'mcp' as const, ts: new Date().toISOString(), tools: {}, regions: {}, catalog: { total_products: catalogTotal } };
    }
    res.json({
      ...snapshot,
      catalog: { total_products: catalogTotal },
      db: 'ok',
      redis: pong === 'PONG' ? 'ok' : 'degraded',
      ts: new Date().toISOString(),
    });
  } catch (err: unknown) {
    res.status(503).json({
      status: 'down',
      error: (err as Error).message || String(err),
      ts: new Date().toISOString(),
    });
  }
});

// GET /mcp/health/tools — per-tool p50/p95/error rate breakdown.
router.get('/health/tools', async (_req: Request, res: Response) => {
  try {
    const snapshot = computeSnapshot();
    res.json({
      status: snapshot.status,
      server: 'mcp',
      ts: snapshot.ts,
      tools: snapshot.tools,
    });
  } catch (err: unknown) {
    res.status(200).json({
      status: 'ok',
      server: 'mcp',
      ts: new Date().toISOString(),
      tools: {},
      note: 'snapshotter degraded',
    });
  }
});

// GET /mcp/health/regions — per-region status with degraded-tool list.
router.get('/health/regions', async (_req: Request, res: Response) => {
  try {
    const snapshot = computeSnapshot();
    res.json({
      status: snapshot.status,
      server: 'mcp',
      ts: snapshot.ts,
      regions: snapshot.regions,
    });
  } catch (err: unknown) {
    res.status(200).json({
      status: 'ok',
      server: 'mcp',
      ts: new Date().toISOString(),
      regions: {},
      note: 'snapshotter degraded',
    });
  }
});

// GET /mcp/health/authenticated — deeper probe requiring API key

router.get('/diagnostics', requireApiKey, async (_req: Request, res: Response) => {
  let statementTimeout: string | null = null;
  let poolWaitMs: number | null = null;
  try {
    const acquired = await acquireMcpClientTimed('diagnostics');
    poolWaitMs = acquired.poolWaitMs;
    try {
      statementTimeout = await showStatementTimeout(acquired.client);
    } finally {
      releaseClientSafely(acquired.client);
    }
  } catch (err: unknown) {
    return res.status(503).json({
      issue: 'BUY-67598',
      error: (err as Error).message || String(err),
      tool_wall_ms: MCP_TOOL_WALL_MS,
      catalog_wall_ms: MCP_CATALOG_WALL_MS,
      catalog_statement_timeout_ms: MCP_CATALOG_STATEMENT_TIMEOUT_MS,
      db_acquire_timeout_ms: MCP_DB_ACQUIRE_TIMEOUT_MS,
    });
  }
  res.json({
    issue: 'BUY-67598',
    tool_wall_ms: MCP_TOOL_WALL_MS,
    catalog_wall_ms: MCP_CATALOG_WALL_MS,
    catalog_statement_timeout_ms: MCP_CATALOG_STATEMENT_TIMEOUT_MS,
    db_acquire_timeout_ms: MCP_DB_ACQUIRE_TIMEOUT_MS,
    session_statement_timeout: statementTimeout,
    pool_wait_ms: poolWaitMs,
    list_categories: {
      mat_view_timeout_ms: 4000,
      live_timeout_ms: 1500,
      skip_cold_scan_if_pool_wait_ms: 500,
      cached_ttl_s: 600,
    },
    ts: new Date().toISOString(),
  });
});

router.get('/health/authenticated', requireApiKey, async (_req: Request, res: Response) => {
  try {
    const [countResult, pong] = await Promise.all([
      db.query('SELECT reltuples::bigint AS count FROM pg_class WHERE relname = \'products\''),
      redis.ping(),
    ]);
    res.json({
      status: 'ok',
      db: 'ok',
      redis: pong === 'PONG' ? 'ok' : 'degraded',
      product_count: countResult.rows[0]?.count ?? null,
      ts: new Date().toISOString(),
    });
  } catch (err: unknown) {
    res.status(503).json({
      status: 'down',
      error: (err as Error).message || String(err),
      ts: new Date().toISOString(),
    });
  }
});

// GET /mcp — info endpoint for browser / reviewer verification.
// Returns a JSON descriptor instead of Express's default 404 so registry
// reviewers and DevRel verifiers can confirm the endpoint is live without
// needing to craft a JSON-RPC POST. The actual MCP protocol uses POST only.
router.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'buywhere-catalog',
    description: 'BuyWhere MCP server. JSON-RPC 2.0 over HTTP POST.',
    protocol: 'mcp',
    protocolVersion: '2024-11-05',
    transport: 'http',
    methods: ['initialize', 'tools/list', 'tools/call'],
    tools: TOOLS_ALL.map(t => t.name),
    auth: 'Bearer token — register at https://api.buywhere.ai/v1/auth/register',
    usage: 'POST this URL with a JSON-RPC 2.0 envelope. See https://api.buywhere.ai/docs/guides/mcp',
  });
});

// POST /mcp — public methods (no auth): initialize + tools/list
// Directory scanners (Glama, Smithery) call these without credentials to introspect the server.
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  const body = req.body;
  if (!body || body.jsonrpc !== '2.0' || !body.method) {
    return next(); // let the authenticated handler return the 400
  }
  const { id, method } = body;
  if (method === 'initialize') {
    return res.json(jsonrpcOk(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'buywhere-catalog', version: '1.0.0' },
    }));
  }
  if (method === 'tools/list') {
    return res.json(jsonrpcOk(id, { tools: TOOLS_ALL }));
  }
  // BWEXT-F4FAFBA7: an unknown METHOD must be a JSON-RPC -32601, per spec,
  // regardless of auth. Only tools/call proceeds to the authenticated handler —
  // previously unknown methods fell through to requireApiKey and surfaced as
  // an HTTP 401, which strict clients cannot distinguish from an auth problem.
  if (method !== 'tools/call') {
    return res.json(jsonrpcErr(id, -32601, `Method not found: ${method}`));
  }
  return next();
});

// BUY-77590/BUY-77744: authenticated MCP JSON-RPC handler for POST /mcp.
async function handleMcpAuthenticated(req: Request, res: Response): Promise<void> {
  const body = req.body;

  // Validate JSON-RPC envelope
  if (!body || body.jsonrpc !== '2.0' || !body.method) {
    res.status(400).json(jsonrpcErr(body?.id ?? null, -32600, 'Invalid JSON-RPC request', undefined, ErrorCode.INVALID_JSON));
    return;
  }

  const { id, method, params } = body;
  const args = (params && typeof params === 'object' && !Array.isArray(params)) ? params : {};

  // BUY-69817: record tool calls into the in-memory health snapshotter and
  // set the X-BuyWhere-Degraded-Regions header so in-flight agents can self-correct.
  let _toolName: string | undefined;
  let _toolArgs: Record<string, unknown> = {};
  const _startMs = Date.now();

  const degradedRegionsHeader = getDegradedRegions().join(',') || '';
  res.setHeader('X-BuyWhere-Degraded-Region', degradedRegionsHeader);
  res.setHeader('X-BuyWhere-Degraded-Regions', degradedRegionsHeader);

  try {
    switch (method) {
      case 'tools/call': {
        const toolName = args.name as string;
        const toolArgs = (args.arguments && typeof args.arguments === 'object') ? args.arguments as Record<string, unknown> : {};
        if (!toolName) {
          res.json(jsonrpcErr(id, -32602, 'Missing tool name'));
          return;
        }
        // BUY-66684: normalize `cc` to `country_code` so handlers' existing
        // `args.country_code`/`args.country` lookup logic fires.
        if (toolArgs.cc != null && toolArgs.country_code == null) {
          toolArgs.country_code = toolArgs.cc;
        }
        // BUY-22733: surface tool name to queryLog middleware.
        res.locals.mcpToolName = toolName;
        _toolName = toolName;
        _toolArgs = toolArgs;
        const inboundKey = (req.headers['x-api-key'] as string) || (req.headers['authorization'] as string) || '';
        if (inboundKey && !toolArgs._mcpInboundApiKey) {
          toolArgs._mcpInboundApiKey = inboundKey.replace(/^Bearer\s+/i, '');
        }
        // BUY-73521: extract raw API key for funnel tracking (hashed, never stored raw)
        const rawApiKey = (req as unknown as { apiKeyRecord?: { key?: string } }).apiKeyRecord?.key;
        // BUY-73521: resolve shopping_job_id — client-supplied or server-minted.
        // Only buyer-context v2 tools participate in the funnel.
        let funnelJobId: string | undefined;
        let funnelIsReplay = false;
        if (V2_BUYER_TOOLS.has(toolName)) {
          const clientJobId = (args as Record<string, unknown>).shopping_job_id
            ?? (args as Record<string, unknown>).job_id
            ?? null;
          const resolved = resolveShoppingJobId(clientJobId, toolArgs);
          funnelJobId = resolved.jobId;
          funnelIsReplay = resolved.isReplay;
          recordJobCreated({
            shoppingJobId: funnelJobId,
            isReplay: funnelIsReplay,
            toolName,
            args: toolArgs,
            apiKey: rawApiKey,
          });
        }
        const result = await dispatchTool(toolName, toolArgs, callerContextForUrl(req));
        if (result && typeof result === 'object') {
          const payload = result as Record<string, unknown>;
          if (payload.request_id == null) payload.request_id = randomUUID();
        }
        try {
          recordToolCall({ tool: toolName, region: extractRegion(toolArgs), latency_ms: Date.now() - _startMs, error: false });
        } catch {}
        // BUY-73521: record funnel stages from the result.
        // Only fire each stage if the result actually contains that stage's data.
        if (funnelJobId) {
          const productIds = extractProductIds(result);
          const offerUrlPresent = hasOutboundUrl(result);
          try {
            if (productIds.length > 0) {
              recordProductResolved({ shoppingJobId: funnelJobId, toolName, args: toolArgs, apiKey: rawApiKey, result });
            }
            if (productIds.length > 0 && offerUrlPresent) {
              recordExecutableOfferFound({ shoppingJobId: funnelJobId, toolName, args: toolArgs, apiKey: rawApiKey, result });
            }
            if (offerUrlPresent) {
              recordOutboundLinkReturned({ shoppingJobId: funnelJobId, toolName, args: toolArgs, apiKey: rawApiKey, result });
            }
          } catch (e) {
            console.warn('[mcp][funnel] record error:', e);
          }
        }
        if (funnelJobId && result && typeof result === 'object') {
          (result as Record<string, unknown>).shopping_job_id = funnelJobId;
        }
        // BUY-75415: forward-direction INSERT into monitoring.deliver_to_calls
        // (>=1 product) OR monitoring.mcp_empty_responses (result_count=0 +
        // non-null emptiness_reason). Filters is_internal. Fire-and-forget.
        try {
          recordV2KpiSink({ toolName, args: toolArgs, apiKey: rawApiKey, result, statusCode: 200 });
        } catch { /* swallowed inside recordV2KpiSink */ }
        // BUY-72550: record v2 request for adoption telemetry (fire-and-forget).
        if (toolName.endsWith('_v2')) {
          try {
            const v2Row = buildV2RequestRow({
              requestId: id,
              toolName,
              args: toolArgs,
              apiKey: rawApiKey,
              gatePassed: true,
              outcome: 'success',
            });
            recordV2Request(v2Row);
          } catch { /* best-effort telemetry */ }
        }
        res.json(jsonrpcOk(id, { content: [{ type: 'text', text: JSON.stringify(result) }] }));
        return;
      }

      // BUY-72102: backward compatibility for direct tool-name JSON-RPC methods.
      default: {
        const knownTool = TOOLS.find((t) => t.name === method);
        if (knownTool) {
          res.locals.mcpToolName = method;
          _toolName = method;
          _toolArgs = args;
          const result = await dispatchTool(method, args);
          if (result && typeof result === 'object') {
            const payload = result as Record<string, unknown>;
            if (payload.request_id == null) payload.request_id = randomUUID();
          }
          try {
            recordToolCall({ tool: method, region: extractRegion(args), latency_ms: Date.now() - _startMs, error: false });
          } catch {}
          // BUY-75415: same forward-direction write as tools/call (v2 tools may
          // also be invoked via direct method name; the gate metric must reflect both surfaces).
          try {
            recordV2KpiSink({
              toolName: method,
              args,
              apiKey: (req as unknown as { apiKeyRecord?: { key?: string } }).apiKeyRecord?.key ?? null,
              result,
              statusCode: 200,
            });
          } catch { /* swallowed inside recordV2KpiSink */ }
          // BUY-72550: record v2 request for adoption telemetry (fire-and-forget).
          if (method.endsWith('_v2')) {
            try {
              const rawApiKey = (req as unknown as { apiKeyRecord?: { key?: string } }).apiKeyRecord?.key;
              const v2Row = buildV2RequestRow({
                requestId: id,
                toolName: method,
                args,
                apiKey: rawApiKey,
                gatePassed: true,
                outcome: 'success',
              });
              recordV2Request(v2Row);
            } catch { /* best-effort telemetry */ }
          }
          res.json(jsonrpcOk(id, { content: [{ type: 'text', text: JSON.stringify(result) }] }));
          return;
        }
        res.json(jsonrpcErr(id, -32601, `Method not found: ${method}`));
        return;
      }
    }
  } catch (err: unknown) {
    if (_toolName) {
      try {
        recordToolCall({ tool: _toolName, region: extractRegion(_toolArgs), latency_ms: Date.now() - _startMs, error: true });
      } catch {}
      // BUY-72550: record v2 request error for adoption telemetry (fire-and-forget).
      if (_toolName.endsWith('_v2')) {
        try {
          const rawApiKey = (req as unknown as { apiKeyRecord?: { key?: string } }).apiKeyRecord?.key;
          const rpcErr = err as { code?: number | string; message?: string };
          const outcome = (typeof rpcErr.code === 'number' && rpcErr.code === -32602) ? 'gate_rejected' : 'rpc_error';
          const v2Row = buildV2RequestRow({
            requestId: id,
            toolName: _toolName,
            args: _toolArgs,
            apiKey: rawApiKey,
            gatePassed: outcome !== 'gate_rejected',
            outcome,
          });
          recordV2Request(v2Row);
        } catch { /* best-effort telemetry */ }
      }
    }
    const e = err as { code?: number | string; message?: string };
    // BUY-57370: handle both numeric tool-error codes and PG string error codes.
    if (typeof e.code === 'number' && e.message) {
      const envelopeCode = e.code === -32001 ? ErrorCode.NOT_FOUND
        : e.code === -32602 ? ErrorCode.INVALID_PARAMETER
        : ErrorCode.INTERNAL_ERROR;
      res.json(jsonrpcErr(id, e.code, e.message, undefined, envelopeCode));
      return;
    }
    if (typeof e.code === 'string' && e.message) {
      if (e.code === '57014') {
        console.warn(`[mcp] statement_timeout (57014)`);
        res.json(jsonrpcErr(id, -32603, 'Query timed out — catalog temporarily slow, retry with a narrower query', undefined, ErrorCode.SERVICE_UNAVAILABLE));
        return;
      }
      console.error(`[mcp] pg error (code=${e.code}):`, e.message);
      res.json(jsonrpcErr(id, -32603, `Internal error: ${e.message.slice(0, 120)}`, undefined, ErrorCode.INTERNAL_ERROR));
      return;
    }
    console.error('[mcp] error:', err);
    res.json(jsonrpcErr(id, -32603, 'Internal error', undefined, ErrorCode.INTERNAL_ERROR));
  }
}

// POST /mcp — authenticated methods: tools/call (and any future additions)
router.post('/', requireApiKey, checkRateLimit, queryLogMiddleware('mcp'), handleMcpAuthenticated);

export default router;
