import { Router, Request, Response, NextFunction } from 'express';
import { randomUUID, createHash } from 'crypto';
import type { PoolClient } from 'pg';
import { db, redis, vectorDb } from '../config';
import { embedQuery } from '../jobs/embedProducts';
import { requireApiKey, checkRateLimit } from '../middleware/apiKey';
import { queryLogMiddleware } from '../middleware/queryLog';
import { recordQueryCacheLookup, recordCacheHitLatency } from '../monitoring/cacheStats';
import { buildErrorEnvelope, ErrorCode, ErrorCodeType } from '../middleware/errors';
import { buildProduct, buildSearchResponse, COUNTRY_CURRENCY, CURRENCY_RATES, deriveEmptiness, EmptinessSignals } from '../lib/response';
import { lookupMerchantMap } from '../lib/merchantLookup';
import { servingReadDbConnect, ReplicaUnavailableError } from '../lib/readReplica';
import { getCachedFxRates } from '../lib/fxRatesLoader';
import { buildDeviceFilter } from '../lib/deviceClassifier';
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
  const state = mcpDegradedCircuitState.get(mcpCircuitKey(tool, stage, country));
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
  if (e?.code === '57014' || e?.code === '55P03' || message.includes('mcp_db_pool_acquire_timeout') || /timeout/i.test(message)) return 'timeout';
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
  const emptinessReason = opts.kind === 'partial_timeout' ? 'partial_timeout' : (opts.kind === 'timeout' ? 'timeout' : opts.kind === 'auth_failure' ? 'auth_failure' : 'api_error');
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
  const conditions = ['id = ANY($1::uuid[])', 'is_active = true'];
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
    const allowed = new Set(result.rows.map((r: { id: string }) => r.id));
    return candidateIds.filter(id => allowed.has(id));
  } catch (err) {
    console.warn('[search] vector candidate market filter failed, using global set:', (err as Error).message);
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
    sea: 'SG',
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
    description: 'Search the BuyWhere product catalog by keyword. Treat deliver_to as REQUIRED for buyer-facing use (ISO-3166 country of the end user); it takes precedence over country_code/country and prevents all-market scans. Returns schema.org/Product entities with name, description, image, and offers (schema.org/AggregateOffer with lowPrice, highPrice, priceCurrency). Covers e-commerce platforms across Singapore, Malaysia, Indonesia, Thailand, Vietnam, and US. Use compact=true for agent-optimized responses with structured_specs, comparison_attributes, and normalized_price_usd fields. BUY-74597 degraded contract: when the catalog query cannot complete inside the user-facing timeout, this tool returns a 200-OK envelope with `meta.status="degraded"`, `meta.emptiness_reason="timeout"` (or `"partial_timeout"` / `"auth_failure"`), `meta.confidence="low"`, and `meta.diagnostic.timed_out_stage` naming the failed stage (catalog_search / offer_aggregation / merchant_join). It never returns an unqualified empty result when the cause is timeout, auth failure, upstream exception, or circuit breaker. Agents should branch on `meta.degraded === true` (or `meta.status === "degraded"`) instead of treating empty `data` as no_match.',
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
        mode: { type: 'string', enum: ['keyword', 'semantic', 'hybrid'], description: 'Search mode: keyword=FTS only, semantic=vector only, hybrid=RRF blend of FTS+vector (default). Falls back to keyword if vector DB or GEMINI_API_KEY unavailable.', default: 'hybrid' },
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
    description: 'Get discounted products sorted by discount percentage. Returns schema.org/Product entities with schema.org/Offer properties: price, priceCurrency, availability, originalPrice, and discountPercentage. Covers Singapore, Malaysia, Indonesia, Thailand, Vietnam, and US e-commerce. Supports currency, region (sea, us, eu, au) and country (SG, US, VN, MY, ...) filters. BUY-74597 degraded contract: when the discount-index scan cannot complete inside the user-facing timeout, this tool returns a 200-OK envelope with `meta.status="degraded"`, `meta.emptiness_reason="timeout"` (or `"partial_timeout"` / `"auth_failure"`), `meta.confidence="low"`, and `meta.diagnostic.timed_out_stage` (typically `offer_aggregation`). It never returns an unqualified empty result when the cause is timeout, auth failure, upstream exception, or circuit breaker. Branch on `meta.degraded === true` or `meta.status === "degraded"`.',
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
    description: 'Use this whenever a user asks about prices, wants to find the cheapest option, or asks "what\'s the best price for X" or "where can I buy X for the lowest price". Returns schema.org/Product entities with schema.org/AggregateOffer (lowPrice, offerCount, priceCurrency) across all merchants. BUY-74597 degraded contract: when the candidates query cannot complete inside the user-facing timeout, this tool returns a 200-OK envelope with `meta.degraded=true`, `meta.status="degraded"`, `meta.emptiness_reason="timeout"` (or `"partial_timeout"` / `"auth_failure"`), `meta.confidence="low"`, and `meta.diagnostic.timed_out_stage="catalog_search"`, with `best_price=null` and `alternatives=[]`. It never returns an unqualified empty result when the cause is timeout, auth failure, upstream exception, or circuit breaker.',
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
    description: 'REQUIRED deliver_to. Search the BuyWhere product catalog by keyword. The deliver_to parameter is REQUIRED (ISO country code, e.g. "SG", "US") — it takes precedence over country_code/country and prevents all-market scans. Always pass deliver_to="SG" (or your buyer\'s country). Returns schema.org/Product entities with name, description, image, and offers (schema.org/AggregateOffer with lowPrice, highPrice, priceCurrency). Covers e-commerce platforms across Singapore, Malaysia, Indonesia, Thailand, Vietnam, and US. Use compact=true for agent-optimized responses with structured_specs, comparison_attributes, and normalized_price_usd fields.',
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
        mode: { type: 'string', enum: ['keyword', 'semantic', 'hybrid'], description: 'Search mode: keyword=FTS only, semantic=vector only, hybrid=RRF blend of FTS+vector (default). Falls back to keyword if vector DB or GEMINI_API_KEY unavailable.', default: 'hybrid' },
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
  const mode = (args.mode as string) || 'hybrid';
  const geminiKey = process.env.GEMINI_API_KEY ?? '';
  const useVector = vectorDb != null && geminiKey !== '' && q !== '' && mode !== 'keyword';
  const domain = (args.domain as string) || '';
  const region = (args.region as string) || '';
  // country_code is canonical; `country` kept as alias for backward compat
  // BUY-6598: Default to SG for search queries. BUY-31962: skip default for
  // empty-q browse mode — no index on country_code makes filtered scan slow,
  // and recent rows are predominantly US/null so SG filter finds nothing.
  // BUY-73666: deliver_to takes precedence over country_code/country per tool
  // schema contract. Without this, MCP clients passing deliver_to="US" get SG
  // results because the country filter was never applied.
  const rawCountry = (((args.deliver_to as string) || (args.country_code as string) || (args.country as string)) || '').toUpperCase();
  const hasExplicitCountry = !!(args.deliver_to || args.country_code || args.country);
  const country = rawCountry || (q && !region ? 'SG' : '');
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

  if (isMcpCircuitOpen('search_products', 'catalog_search', country || null)) {
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
  const cacheKey = `fts:v7:${q}:${domain}:${region}:${country}:${category}:${currency}:${minPrice}:${maxPrice}:${limit}:${offset}:${compact ? 'c' : 'f'}:${effectiveCacheMode}`;
  // BUY-68652: true if we ended up serving keyword FTS rows for a semantic/hybrid
  // request (embed/vector unavailable). The result must be cached under the 'kw'
  // suffix, never the requested-mode key.
  let keywordFallbackServed = !useVector;
  try {
    const cached = await recordQueryCacheLookup(redis, cacheKey, () => redis.get(cacheKey));
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.results) {
        // BUY-75411: record cache-hit wall-clock latency so the admin probe
        // can report p95 over the sliding window.
        await recordCacheHitLatency(redis, Date.now() - t0);
        return { ...parsed, cached: true, response_time_ms: Date.now() - t0 };
      }
    }
  } catch (_) { /* redis miss — proceed */ }

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
  if (country) {
    tierParams.push(country.toUpperCase());
    tierConditions.push(`sp.country_code = $${tierParams.length}`);
  }
  // NOTE: category ILIKE intentionally omitted — search_products has category
  // as a slug; REST tier uses exact match. Add tierParams/tierConditions here
  // if category filtering on the tier becomes needed.
  const tierWhere = tierConditions.length ? `WHERE ${tierConditions.join(' AND ')}` : '';

  let rows: unknown[];
  let total: number;

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
    // BUY-56185: statement_timeout = 4s lets the catalog_search stage fail
    // fast into the BUY-74597 degraded envelope rather than holding a pooled
    // connection across the full client timeout. The GIN bitmap plan must
    // complete inside this budget; anything longer signals plan regression
    // or pool exhaustion.
    // Reduce timeout to protect against runaway queries and increase work_mem
    // to encourage bitmap GIN plans. Additionally, disable sequential scans for
    // this short-lived request to force the planner to use the GIN indexes
    // (search_vector + region/country). This mitigates the observed ~12s
    // catalog_search latency on SEA markets.
    await searchClient.query('SET statement_timeout = 4000');
    await searchClient.query('SET work_mem = \'64MB\''); // BUY-26343: encourage GIN bitmap plan over btree index scan for FTS queries
    await searchClient.query('SET enable_seqscan = off'); // force index usage for this query
    const COUNT_CAP = 1001;
    if (q) {
      // BUY-72082: count via tier table (97M, GIN-indexed) for fast total
      const countResult = await searchClient.query(
        `SELECT COUNT(*) FROM (SELECT 1 FROM search_products sp ${tierWhere} LIMIT ${COUNT_CAP}) _sub`,
        tierParams
      );
      total = parseInt(countResult.rows[0].count, 10);
      // BUY-73908: if the lexical catalog tier has zero matches, do not let
      // hybrid/vector recall resurrect unrelated rows for a must-miss query.
      // The L2 leak was q=zzzz_no_match returning Google Shopping synthetic
      // rows via vector-only candidates while REST correctly returned no_match.
      if (total === 0) {
        rows = [];
      } else if (useVector) {
        // BUY-31962 / BUY-41138: hybrid search (RRF) or keyword FTS fallback.
        // Hybrid and semantic paths embed the query via Jina AI, query the vector DB
        // separately, then merge in application code (two separate PG instances).
        // Embed query (retrieval.query task); Redis-cache 60s keyed by base64 query
        let queryVec: string | null = null;
        try {
          const embedKey = `qembed:${Buffer.from(q).toString('base64').slice(0, 48)}`;
          queryVec = await recordQueryCacheLookup(redis, embedKey, () => redis.get(embedKey));
          if (!queryVec) {
            queryVec = await embedQuery(q, geminiKey);
            await redis.set(embedKey, queryVec, 'EX', 60).catch(() => {});
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
              // vector table. Restrict to the 512-dim Gemini model and fail open to
              // keyword FTS if pgvector still rejects the query.
              const vecRows = await vectorDb.query<{ product_id: string }>(
                `SELECT product_id FROM product_embeddings
                 WHERE model_ver = 'gemini-embedding-001@512'
                 ORDER BY embedding <=> $1::vector LIMIT 200`,
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
              vectorCandidateIds = null;
            }
          } else {
            // Hybrid: app-level RRF of FTS ranks + vector ranks
            let vecRows: { product_id: string }[] = [];
            let ftsRows: { id: string }[] = [];
            try {
              // BUY-68327: keep vector failures (including 512/1024 dimension
              // mismatch) from rejecting the whole hybrid request.
              const vecResult = await vectorDb.query<{ product_id: string }>(
                `SELECT product_id FROM product_embeddings
                 WHERE model_ver = 'gemini-embedding-001@512'
                 ORDER BY embedding <=> $1::vector LIMIT 200`,
                [queryVec]
              );
              vecRows = vecResult.rows;
            } catch (vecErr) {
              console.warn('[search] hybrid vector query failed, FTS only:', (vecErr as Error).message);
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
            const detailResult = await searchClient.query(
              `SELECT id, sku AS source, source AS domain, url, title,
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
          tierParams.push(limit + offset);
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
            const detailResult = await searchClient.query(
              `SELECT id, sku AS source, source AS domain, url, title,
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
        tierParams.push(limit + offset);
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
          const detailResult = await searchClient.query(
            `SELECT id, sku AS source, source AS domain, url, title,
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
      const rawResult = await searchClient.query(
        `SELECT id, sku AS source, source AS domain, url, title,
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
// BUY-72044 / P2.6A: unfiltered probe for `deliver_to_missing` reasoning. Runs
    // INSIDE the `try` (before the client is released) so we reuse the same
    // connection. Only fires when the caller omitted deliver_to/country_code/country
    // AND the keyword is set — that's the only path where the unfiltered signal
    // changes the reason. LIMIT 1 keeps this off the GIN hot path.
    if (q && !deliverToPresent) {
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
      } catch (_) {
        unfilteredHasAnyData = null;
      }
    }
    // BUY-71542 / P2.6: region/category existence probes — best-effort, swallow
    // errors so the empty envelope still lands when the DB is healthy but the
    // query is the issue.
    if (country) {
      try {
        const probe = await searchClient.query(
          `SELECT EXISTS (SELECT 1 FROM products WHERE is_active = true AND country_code = $1 LIMIT 1) AS any_match`,
          [country.toUpperCase()]
        );
        regionHasAnyDataProbe = (probe.rows[0] as { any_match: boolean } | undefined)?.any_match === true;
      } catch (_) { /* regionHasAnyDataProbe stays at default */ }
    }
    if (category) {
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
      } catch (_) { /* categoryHasAnyDataProbe stays at default */ }
    }
    recordMcpCircuitSuccess('search_products', 'catalog_search', country || null);
  } catch (e: any) {
    const degradedKind = classifyMcpDegradedKind(e);
    recordMcpCircuitFailure('search_products', 'catalog_search', country || null);
    console.warn(`[search_products] BUY-74597: catalog_search degraded (${degradedKind}) — returning MCP degraded envelope`);
    return buildSearchResponse(
      [], 0, limit, offset, Date.now() - t0, false,
      true, undefined, country || null,
      deriveEmptiness({
        regionHasAnyData: regionHasAnyDataProbe,
        categoryHasAnyData: categoryHasAnyDataProbe,
        apiError: degradedKind === 'upstream_exception',
        rateLimited: false,
        regionSupported: !country || (SUPPORTED_REGIONS as readonly string[]).includes(country.toUpperCase()),
        categoryRequested: !!category,
        requestedCategory: category || null,
        requestedCountry: country || null,
        rateLimitRemaining: null,
        deliverToPresent,
        unfilteredHasAnyData,
        queryAmbiguous: null,
        degradedKind,
        timedOutStage: 'catalog_search',
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

  const result = buildSearchResponse(
    products, total!, limit, offset, Date.now() - t0, false,
    undefined, undefined, country || null,
    emptiness,
  );
  if (q && products.length === 0) {
    (result.meta as unknown as Record<string, unknown>).emptiness_reason = 'no_match';
  }

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
    result = await db.query(
      `SELECT id, sku AS source, source AS domain, url, title,
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
    result = await db.query(
      `SELECT id, sku AS source, source AS domain, url, title,
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
  const region = market.rawRegion;
  const effectiveCountry = market.country;
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

  const cacheKey = `deals_mcp:v2:${currency}:${minDiscount}:${region}:${region}:${effectiveCountry}:${limit}:${offset}`;
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
  

  const conditions: string[] = [
    `currency = $1`,
    `price > 0`,
    `is_active = true`,
  ];
  if (useDiscountCol) {
    conditions.push(`discount_pct >= $2`);
  } else {
    // Guard: only consider rows where original_price is a valid numeric string.
    // Matches the partial index predicate on idx_products_deals_country/region.
    conditions.push(`metadata->>'original_price' ~ '^[0-9]+(\\.[0-9]+)?$'`);
    conditions.push(`(metadata->>'original_price')::numeric > price`);
    conditions.push(`((1 - price / NULLIF((metadata->>'original_price')::numeric, 0)) * 100) >= $2`);
  }
  const params: unknown[] = [currency, minDiscount];

  if (region) {
    params.push(region);
    conditions.push(`region = $${params.length}`);
  }
  if (effectiveCountry) {
    params.push(effectiveCountry);
    conditions.push(`country_code = $${params.length}`);
  }

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
    await dealsClient.query('SET statement_timeout = 30000'); // BUY-73961 (2026-08-24): raise from 15s → 30s; mirror of mcp-railway/src/routes/mcp.ts to avoid drift. FBP/get_deals CTE mean=10s/p99.9=370s, 15s window tripped -32603 on every lock-wave.
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
    const candidateLimit = 2000;
    const candidateParams = [...params, candidateLimit];
    const dataResult = await dealsClient.query(
      `WITH cand AS (
         SELECT id, discount_pct AS cand_discount, updated_at AS cand_updated
         FROM products
         WHERE ${whereClause}
         ORDER BY discount_pct DESC
         LIMIT $${candidateParams.length}
       )
       SELECT p.id, p.sku AS source, p.source AS domain, p.url, p.title,
              p.price,
              CASE WHEN p.metadata->>'original_price' ~ '^[0-9]+(\\.[0-9]+)?$'
                   THEN (p.metadata->>'original_price')::numeric ELSE NULL END AS original_price,
              p.currency, p.image_url, p.metadata, p.updated_at, p.region, p.country_code,
              p.url_last_checked_at, p.url_status,
              p.discount_pct
       FROM cand JOIN products p ON p.id = cand.id
       ORDER BY cand.cand_discount DESC, cand.cand_updated DESC
       LIMIT ${limit} OFFSET ${offset}`,
      candidateParams
    );
    total = dataResult.rows.length;
    products = dataResult.rows.map((r: Record<string, unknown>) =>
      buildProduct(r, currency, false, undefined, caller)
    );
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
      if (Array.isArray(parsed.data) && parsed.data.length > 0) {
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
  const MAT_VIEW_TIMEOUT_MS = 8000;
  const LIVE_TIMEOUT_MS = 1800;
  const HARD_TIMEOUT_MS = 6000;
  const queryPromise = (async () => {
    const client = await servingReadDbConnect().catch((err: unknown) => {
      if (err instanceof ReplicaUnavailableError) {
        console.warn('[list_categories] replica unavailable, falling back to primary:', err.message);
        return acquireMcpClient();
      }
      console.warn('[list_categories] db.connect failed:', (err as Error)?.message);
      throw { code: -32603, message: 'Database connection timeout' };
    });
    try {
      await client.query('SET statement_timeout = 8000');
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
             ORDER BY product_count DESC
             LIMIT 100`,
            [country]
          );
          rows = summaryResult.rows;
        }
        // BUY-69823: if matview empty, try a bounded live GROUP BY with a tighter
        // per-query timeout — prevents a 50K-row scan from burning the full 8s.
        if (rows.length === 0) {
          try {
            await client.query(`SET statement_timeout = ${LIVE_TIMEOUT_MS}`);
            await client.query(`SET work_mem = '256MB'`);
            await client.query(`SET enable_hashagg = off`);
            const liveResult = await client.query(
              `SELECT category_path[1] AS slug, category_path[1] AS name, COUNT(*) AS product_count
               FROM products
               WHERE country_code = $1
                 AND category_path[1] IS NOT NULL
                 AND is_active = true
               GROUP BY category_path[1]
               ORDER BY COUNT(*) DESC
               LIMIT 100`,
              [country]
            );
            if (liveResult.rows.length > 0) rows = liveResult.rows;
          } catch (_) {
            // live GROUP BY timed out — fall through to recent-products fallback
          } finally {
            await client.query(`SET statement_timeout = ${MAT_VIEW_TIMEOUT_MS}`);
          }
        }
        if (rows.length === 0) {
          // BUY-60056: materialized view is empty/stale in production. Instead of
          // returning unavailable or running a full-table GROUP BY, sample recent
          // products through the updated_at path and derive a bounded category list.
          // BUY-69823: use LIVE_TIMEOUT_MS so a 50K-row scan never exceeds 1.8s.
          try {
            await client.query(`SET statement_timeout = ${LIVE_TIMEOUT_MS}`);
            const fallbackResult = await client.query(
              `SELECT slug, slug AS name, COUNT(*)::int AS product_count
               FROM (
                 SELECT category_path, country_code
                 FROM products
                 WHERE country_code = $1
                   AND category_path[1] IS NOT NULL
                   AND is_active = true
                 ORDER BY updated_at DESC
                 LIMIT 50000
               ) _recent_categories
               CROSS JOIN LATERAL (SELECT category_path[1] AS slug) _cat
               GROUP BY slug
               ORDER BY product_count DESC
               LIMIT 100`,
              [country]
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
      if (rows.length === 0) {
        rows = ['Electronics', 'Computers', 'Mobile Phones', 'Home', 'Fashion'].map((name) => ({
          slug: name.toLowerCase().replace(/\s+/g, '-'),
          name,
          product_count: 0,
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
  const productName = ((args.product_name as string) || (args.q as string) || '').trim();
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

  const CANDIDATE_POOL = Math.max(limit * 50, 500);

  // BUY-74597: short-circuit when this tool/stage/country has tripped its breaker.
  if (isMcpCircuitOpen('find_best_price', 'catalog_search', country || null)) {
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
    await bestPriceClient.query('SET statement_timeout = 30000'); // BUY-73961 (2026-08-24): raise from 4s → 30s; mirror of mcp-railway/src/routes/mcp.ts (FBP was 10s there, 4s here — both raised to 30s). CTE mean=10s/p99.9=370s.
    await bestPriceClient.query('SET enable_seqscan = off'); // force GIN index plan; mitigates catalog_search timeouts on SEA markets

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
    tierParams.push(requestedCountry);
    tierConditions.push(`sp.country_code = $${tierParams.length}`);
    if (region) {
      tierParams.push(region);
      tierConditions.push(`sp.region = $${tierParams.length}`);
    }
    if (minPrice > 0) {
      tierParams.push(minPrice);
      tierConditions.push(`sp.price >= $${tierParams.length}`);
    }
    const tierWhere = tierConditions.length ? `WHERE ${tierConditions.join(' AND ')}` : '';

    tierParams.push(CANDIDATE_POOL, limit);
    result = await bestPriceClient.query(
      `WITH cand AS (
         SELECT sp.id, sp.price, sp.updated_at,
                ts_rank(sp.search_vector, plainto_tsquery('english', $1)) AS rk
         FROM search_products sp ${tierWhere}
         LIMIT $${tierParams.length - 1}
       ), page_ids AS (
         SELECT id, price, updated_at, rk
         FROM cand
         ORDER BY rk DESC NULLS LAST,
                  (CASE WHEN price BETWEEN 5 AND 10000 THEN price END) ASC NULLS LAST,
                  updated_at DESC
         LIMIT $${tierParams.length}
       )
       SELECT p.id, p.title, p.price, p.currency, p.source AS domain, p.url, p.image_url,
              p.country_code, p.updated_at, p.category, p.category_path, p.metadata,
              p.url_last_checked_at, p.url_status
       FROM page_ids pi
       JOIN products p ON p.id = pi.id
       WHERE p.is_active = true
       ORDER BY (CASE WHEN pi.price BETWEEN 5 AND 10000 THEN pi.price END) ASC NULLS LAST, pi.updated_at DESC`,
      tierParams
    );
    recordMcpCircuitSuccess('find_best_price', 'catalog_search', country || null);
  } catch (e: any) {
    const degradedKind = classifyMcpDegradedKind(e);
    recordMcpCircuitFailure('find_best_price', 'catalog_search', country || null);
    console.warn(`[find_best_price] BUY-74597: catalog_search degraded (${degradedKind}) — returning MCP degraded envelope`);
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

  const isAccessory = (r: Record<string, unknown>) => {
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

  const data = finalRows.slice(0, 10).map((r: Record<string, unknown>) => {
    const price = r.price != null ? parseFloat(r.price as string) : null;
    const curr = ((r.currency as string) || currency).toUpperCase();
    const fxRate = rates[curr] ?? CURRENCY_RATES[curr] ?? 1;
    return {
      id: r.id,
      title: r.title,
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
      // BUY-75291: MCP /search_products uses fts:v7:* keys; prior ingestion
      // paths only busted products:* + search:*, so per-(q,cc) snapshots
      // survived reindexes indefinitely. Clear the FTS namespace on success.
      const ftsKeys = await redis.keys('fts:v7:*');
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
    throw { code: -32001, message: 'Vector search not available — vector DB not configured' };
  }

  // Step 1: get reference embedding from vector DB
  let refResult;
  try {
    refResult = await vectorDb.query<{ embedding: string }>(
      `SELECT embedding::text FROM product_embeddings WHERE product_id = $1`,
      [productId]
    );
  } catch {
    throw { code: -32001, message: 'No embedding found for this product — backfill may still be running' };
  }
  if (!refResult.rows.length) {
    throw { code: -32001, message: 'No embedding found for this product — backfill may still be running' };
  }
  const refEmbedding = refResult.rows[0].embedding;

  // Step 2: find nearest neighbours in vector DB (excluding source product)
  let nearResult;
  try {
    nearResult = await vectorDb.query<{ product_id: string; distance: number }>(
      `SELECT product_id, (embedding <=> $1::vector)::float AS distance
       FROM product_embeddings WHERE product_id != $2
       ORDER BY distance LIMIT $3`,
      [refEmbedding, productId, limit]
    );
  } catch {
    throw { code: -32001, message: 'No similar products found' };
  }
  if (!nearResult.rows.length) {
    throw { code: -32001, message: 'No similar products found' };
  }

  // Step 3: fetch product details from main DB
  const nearIds = nearResult.rows.map(r => r.product_id);
  const ph = nearIds.map((_, i) => `$${i + 1}`).join(',');
  const detailResult = await db.query(
    `SELECT id, title, price, currency, source AS domain, url, image_url
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
  if (!market) return;
  const mapped = MARKET_TO_COUNTRY[market.toLowerCase()] || market.toUpperCase();
  if (!args.country_code && !args.country) {
    args.country_code = mapped;
  }
}

// BUY-71129 (re-applied, was clobbered by 554950c7): caller identity
// thread-through for click attribution. Mirrors routes/products.ts.
function callerContextForUrl(req: Request): { apiKeyId: string; keyHash: string } | null {
  const rec = (req as Request & { apiKeyRecord?: { id?: string; key?: string } }).apiKeyRecord;
  if (!rec || !rec.id || !rec.key) return null;
  return { apiKeyId: rec.id, keyHash: createHash('sha256').update(rec.key).digest('hex') };
}

async function dispatchTool(name: string, args: Record<string, unknown>, caller?: ReturnType<typeof callerContextForUrl>) {
  normalizeMarketArg(args);
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
  const productName = String(args.product_name || args.q || '').trim();
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
  return { jsonrpc: '2.0', id, result, request_id: randomUUID(), timestamp: new Date().toISOString() };
}
function jsonrpcErr(id: unknown, code: number, message: string, data?: unknown, envelopeCode?: string) {
  const errorData: Record<string, unknown> = data != null ? { detail: data } : {};
  if (envelopeCode) {
    errorData.envelope = buildErrorEnvelope(envelopeCode as ErrorCodeType, message);
  }
  return { jsonrpc: '2.0', id, error: { code, message, ...(Object.keys(errorData).length ? { data: errorData } : {}) }, request_id: randomUUID(), timestamp: new Date().toISOString() };
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
function extractRegion(toolArgs: Record<string, unknown>): SupportedRegion {
  const raw = (
    (toolArgs.deliver_to as string)
    || (toolArgs.country_code as string)
    || (toolArgs.country as string)
    || (toolArgs.region as string)
    || 'SG'
  ).toString().trim().toUpperCase();
  const REGION_TO_COUNTRY: Record<string, string> = {
    SG: 'SG', US: 'US', MY: 'MY', TH: 'TH', VN: 'VN',
    PH: 'PH', ID: 'ID', GB: 'GB', IN: 'IN', AU: 'AU',
    SEA: 'SG',
  };
  const normalised = REGION_TO_COUNTRY[raw] || raw;
  return (SUPPORTED_REGIONS as readonly string[]).includes(normalised)
    ? (normalised as SupportedRegion)
    : 'SG';
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
  return next();
});

// POST /mcp — authenticated methods: tools/call (and any future additions)
router.post('/', requireApiKey, checkRateLimit, queryLogMiddleware('mcp'), async (req: Request, res: Response) => {
  const body = req.body;

  // Validate JSON-RPC envelope
  if (!body || body.jsonrpc !== '2.0' || !body.method) {
    return res.status(400).json(jsonrpcErr(body?.id ?? null, -32600, 'Invalid JSON-RPC request', undefined, ErrorCode.INVALID_JSON));
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
          return res.json(jsonrpcErr(id, -32602, 'Missing tool name'));
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
          // BUY-73521: record job_created stage.
          recordJobCreated({
            shoppingJobId: funnelJobId,
            isReplay: funnelIsReplay,
            toolName,
            args: toolArgs,
            apiKey: rawApiKey,
          });
        }
        const result = await dispatchTool(toolName, toolArgs, callerContextForUrl(req));
        try {
          recordToolCall({ tool: toolName, region: extractRegion(toolArgs), latency_ms: Date.now() - _startMs, error: false });
        } catch {}
        // BUY-73521: record funnel stages from the result.
        // Only fire each stage if the result actually contains that stage's data.
        if (funnelJobId) {
          const productIds = extractProductIds(result);
          const offerUrlPresent = hasOutboundUrl(result);
          try {
            // product_resolved: at least one product id in response
            if (productIds.length > 0) {
              recordProductResolved({ shoppingJobId: funnelJobId, toolName, args: toolArgs, apiKey: rawApiKey, result });
            }
            // executable_offer_found: merchant + (price available or offer url)
            if (productIds.length > 0 && offerUrlPresent) {
              recordExecutableOfferFound({ shoppingJobId: funnelJobId, toolName, args: toolArgs, apiKey: rawApiKey, result });
            }
            // outbound_link_returned: outbound_url present
            if (offerUrlPresent) {
              recordOutboundLinkReturned({ shoppingJobId: funnelJobId, toolName, args: toolArgs, apiKey: rawApiKey, result });
            }
          } catch (e) {
            console.warn('[mcp][funnel] record error:', e);
          }
        }
        // BUY-73521: inject shopping_job_id into the response JSON so callers can
        // continue the session without re-supplying it.
        if (funnelJobId && result && typeof result === 'object') {
          (result as Record<string, unknown>).shopping_job_id = funnelJobId;
        }
        // BUY-75415: forward-direction INSERT into monitoring.deliver_to_calls
        // (>=1 product) OR monitoring.mcp_empty_responses (result_count=0 +
        // non-null emptiness_reason). Filters is_internal. Fire-and-forget.
        try {
          recordV2KpiSink({
            toolName,
            args: toolArgs,
            apiKey: rawApiKey,
            result,
            statusCode: 200,
          });
        } catch { /* swallowed inside recordV2KpiSink */ }
        // BUY-72550: record v2 request for adoption telemetry (fire-and-forget).
        if (toolName.endsWith('_v2')) {
          try {
            const v2Row = buildV2RequestRow({
              requestId: id,
              toolName,
              args: toolArgs,
              apiKey: rawApiKey,
              gatePassed: true, // we reached dispatchTool, so gate didn't reject
              outcome: 'success',
            });
            recordV2Request(v2Row);
          } catch { /* best-effort telemetry */ }
        }
        return res.json(jsonrpcOk(id, {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        }));
      }

      // BUY-72102: backward compatibility for direct tool-name JSON-RPC methods.
      default: {
        const knownTool = TOOLS.find((t) => t.name === method);
        if (knownTool) {
          res.locals.mcpToolName = method;
          _toolName = method;
          _toolArgs = args;
          const result = await dispatchTool(method, args);
          try {
            recordToolCall({ tool: method, region: extractRegion(args), latency_ms: Date.now() - _startMs, error: false });
          } catch {}
          // BUY-75415: same forward-direction write as tools/call (v2 tools may
          // also be invoked via direct method name; the gate metric must reflect
          // both surfaces).
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
                gatePassed: true, // we reached dispatchTool, so gate didn't reject
                outcome: 'success',
              });
              recordV2Request(v2Row);
            } catch { /* best-effort telemetry */ }
          }
          return res.json(jsonrpcOk(id, {
            content: [{ type: 'text', text: JSON.stringify(result) }],
          }));
        }
        return res.json(jsonrpcErr(id, -32601, `Method not found: ${method}`));
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
      return res.json(jsonrpcErr(id, e.code, e.message, undefined, envelopeCode));
    }
    if (typeof e.code === 'string' && e.message) {
      if (e.code === '57014') {
        console.warn(`[mcp] statement_timeout (57014)`);
        return res.json(jsonrpcErr(id, -32603, 'Query timed out — catalog temporarily slow, retry with a narrower query', undefined, ErrorCode.SERVICE_UNAVAILABLE));
      }
      console.error(`[mcp] pg error (code=${e.code}):`, e.message);
      return res.json(jsonrpcErr(id, -32603, `Internal error: ${e.message.slice(0, 120)}`, undefined, ErrorCode.INTERNAL_ERROR));
    }
    console.error('[mcp] error:', err);
    return res.json(jsonrpcErr(id, -32603, 'Internal error', undefined, ErrorCode.INTERNAL_ERROR));
  }
});

export default router;
