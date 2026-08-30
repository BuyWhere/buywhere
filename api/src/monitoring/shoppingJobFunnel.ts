/**
 * shoppingJobFunnel.ts — BUY-73521 purchase-job funnel instrumentation.
 *
 * Tracks the WP5 shopping_job_id funnel: job -> resolved product -> executable offer -> outbound link.
 * This replaces raw request volume as the north-star metric.
 *
 * Design:
 *   - Funnel stages: job_created, product_resolved, executable_offer_found, outbound_link_returned
 *   -shopping_job_id: client-supplied (URL-safe, <=128 chars) OR server-minted (randomUUID)
 *   - is_internal: flagged for probe traffic, excluded from north-star conversion metrics
 *   - Buffer: in-memory FIFO, flushed every 5 seconds
 *   - Pool: catalogDb (monitoring schema)
 *   - Failure mode: SILENT DROP — never blocks the JSON-RPC response
 *
 * Acceptance gates (BUY-73521):
 *   - Schema/table exists in monitoring DB
 *   - 20+ live external-like smoke jobs traceable end-to-end without raw key leakage
 *   - Internal probes marked is_internal=true, excluded from external metrics
 */

import { createHash } from 'crypto';
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { catalogDb } from '../config';

const FLUSH_INTERVAL_MS = 5_000;
const MAX_BUFFER = 5_000;

// Funnel stages in order
export type FunnelStage = 'job_created' | 'product_resolved' | 'executable_offer_found' | 'outbound_link_returned';

// Known internal/probe API key prefixes — these get is_internal=true
const INTERNAL_KEY_PREFIXES = ['rex-', 'monitor-', 'health-', 'atlas-', 'probe-', 'test-'];

/**
 * A client-provided shopping_job_id must be URL-safe and <=128 chars.
 * If it doesn't match, we ignore it and mint a server-side UUID.
 */
function isValidClientJobId(v: unknown): boolean {
  if (typeof v !== 'string' || v.length === 0 || v.length > 128) return false;
  return /^[A-Za-z0-9._~:-]+$/.test(v);
}

/**
 * Classify an API key as internal/probe traffic.
 * Keys with known internal prefixes are flagged is_internal=true.
 */
function classifyIsInternal(apiKey: string | null | undefined): boolean {
  if (!apiKey) return false;
  const lower = apiKey.toLowerCase();
  return INTERNAL_KEY_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function hashApiKey(rawKey: string | null | undefined): string | null {
  if (!rawKey) return null;
  return createHash('sha256').update(rawKey).digest('hex').slice(0, 16);
}

/**
 * Derive deliver_to from tool args: deliver_to > country_code > country
 */
function deriveDeliverTo(args: Record<string, unknown> | null | undefined): string {
  if (!args) return '';
  const dt = args.deliver_to;
  if (typeof dt === 'string' && dt.trim()) return dt.trim().toUpperCase();
  const cc = args.country_code;
  if (typeof cc === 'string' && cc.trim()) return cc.trim().toUpperCase();
  const c = args.country;
  if (typeof c === 'string' && c.trim()) return c.trim().toUpperCase();
  return '';
}

/**
 * Derive country_code (after normalization) — same as deliver_to for v2 tools
 */
function deriveCountryCode(args: Record<string, unknown> | null | undefined): string | null {
  const dt = deriveDeliverTo(args);
  return dt || null;
}

/**
 * Extract query text from tool args (for job_created stage)
 */
function deriveQueryText(args: Record<string, unknown> | null | undefined): string | null {
  if (!args) return null;
  const q = args.q ?? args.product_name ?? args.product ?? args.ids ?? null;
  if (typeof q === 'string' && q.trim()) return q.trim().slice(0, 500);
  if (Array.isArray(q) && q.length > 0) return `[${q.length} items]`;
  return null;
}

/**
 * Extract product IDs from tool response — used for product_resolved stage
 */
export function extractProductIds(result: unknown): string[] {
  if (!result || typeof result !== 'object') return [];

  const r = result as Record<string, unknown>;

  // Search/deals/best_price response shape
  if (Array.isArray(r.data)) {
    return r.data
      .filter((p): p is Record<string, unknown> => p != null && typeof p === 'object')
      .map((p) => String(p.id ?? ''))
      .filter(Boolean);
  }
  if (Array.isArray(r.results)) {
    return r.results
      .filter((p): p is Record<string, unknown> => p != null && typeof p === 'object')
      .map((p) => String(p.id ?? ''))
      .filter(Boolean);
  }
  if (Array.isArray(r.products)) {
    return r.products
      .filter((p): p is Record<string, unknown> => p != null && typeof p === 'object')
      .map((p) => String(p.id ?? ''))
      .filter(Boolean);
  }

  // Single product response
  if (r.id) {
    return [String(r.id)];
  }

  // find_best_price response: best_price + alternatives
  const bestPrice = r.best_price as Record<string, unknown> | undefined;
  if (bestPrice?.id) {
    const ids = [String(bestPrice.id)];
    const alts = r.alternatives as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(alts)) {
      for (const alt of alts) {
        if (alt?.id) ids.push(String(alt.id));
      }
    }
    return ids;
  }

  return [];
}

/**
 * Check if response has outbound URLs (executable offer + outbound link)
 */
export function hasOutboundUrl(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;

  const r = result as Record<string, unknown>;

  // Direct outbound_url field (v2 contract)
  if (r.outbound_url && typeof r.outbound_url === 'string') return true;

  // Per-product outbound_url (compare_products_v2, get_product_v2)
  const products = Array.isArray(r.data) ? r.data
    : Array.isArray(r.results) ? r.results
    : Array.isArray(r.products) ? r.products
    : [];

  for (const p of products) {
    if (p && typeof p === 'object') {
      const prod = p as Record<string, unknown>;
      if (prod.outbound_url && typeof prod.outbound_url === 'string') return true;
      // Also check click_url / affiliate_url for completeness
      if (prod.click_url && typeof prod.click_url === 'string') return true;
    }
  }

  // find_best_price: check best_price and alternatives
  const bestPrice = r.best_price as Record<string, unknown> | undefined;
  if (bestPrice) {
    if (bestPrice.outbound_url || bestPrice.url || bestPrice.click_url) return true;
    const alts = r.alternatives as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(alts)) {
      for (const alt of alts) {
        if (alt?.outbound_url || alt?.url || alt?.click_url) return true;
      }
    }
  }

  return false;
}

/**
 * Extract merchant info from result (for executable_offer_found stage)
 */
function extractMerchantInfo(result: unknown): { merchant_id: string | null; merchant_name: string | null } {
  if (!result || typeof result !== 'object') return { merchant_id: null, merchant_name: null };

  const r = result as Record<string, unknown>;

  // Check best_price first (find_best_price response)
  const bestPrice = r.best_price as Record<string, unknown> | undefined;
  if (bestPrice) {
    return {
      merchant_id: bestPrice.merchant_id ? String(bestPrice.merchant_id) : (bestPrice.merchant ? String(bestPrice.merchant) : null),
      merchant_name: bestPrice.merchant ? String(bestPrice.merchant) : null,
    };
  }

  // Check products array
  const products = Array.isArray(r.data) ? r.data
    : Array.isArray(r.results) ? r.results
    : Array.isArray(r.products) ? r.products
    : [];

  if (products.length > 0) {
    const first = products[0] as Record<string, unknown>;
    return {
      merchant_id: first.merchant_id ? String(first.merchant_id) : (first.merchant ? String(first.merchant) : null),
      merchant_name: first.merchant ? String(first.merchant) : null,
    };
  }

  return { merchant_id: null, merchant_name: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Funnel row type
// ─────────────────────────────────────────────────────────────────────────────

export interface ShoppingJobFunnelRow {
  shopping_job_id: string;
  funnel_stage: FunnelStage;
  tool_name: string;
  api_key_hash: string | null;
  deliver_to: string;
  country_code: string | null;
  query_text: string | null;
  product_id: string | null;
  merchant_id: string | null;
  merchant_name: string | null;
  offer_url_present: boolean;
  is_internal: boolean;
  is_replay: boolean;
  stage_data: Record<string, unknown> | null;
  created_at: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Buffer and flush logic
// ─────────────────────────────────────────────────────────────────────────────

const buffer: ShoppingJobFunnelRow[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let flushInFlight = false;
let started = false;

async function flushOnce(pool: Pool): Promise<void> {
  if (buffer.length === 0) return;
  if (flushInFlight) return;
  flushInFlight = true;

  const batch = buffer.splice(0, buffer.length);
  let client: PoolClient | null = null;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const cols = [
      'shopping_job_id',
      'funnel_stage',
      'tool_name',
      'api_key_hash',
      'deliver_to',
      'country_code',
      'query_text',
      'product_id',
      'merchant_id',
      'merchant_name',
      'offer_url_present',
      'is_internal',
      'is_replay',
      'stage_data',
      'created_at',
    ];

    const valuesSql: string[] = [];
    const params: unknown[] = [];

    for (let i = 0; i < batch.length; i++) {
      const r = batch[i];
      const base = i * cols.length;
      valuesSql.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15})`);

      params.push(
        r.shopping_job_id,
        r.funnel_stage,
        r.tool_name,
        r.api_key_hash,
        r.deliver_to,
        r.country_code,
        r.query_text,
        r.product_id,
        r.merchant_id,
        r.merchant_name,
        r.offer_url_present,
        r.is_internal,
        r.is_replay,
        r.stage_data ? JSON.stringify(r.stage_data) : null,
        r.created_at,
      );
    }

    const sql = `INSERT INTO monitoring.shopping_job_funnel (${cols.join(', ')}) VALUES ${valuesSql.join(', ')} ON CONFLICT (shopping_job_id, funnel_stage) DO NOTHING`;
    await client.query(sql, params);
    await client.query('COMMIT');
  } catch (err) {
    try {
      if (client) await client.query('ROLLBACK');
    } catch { /* ignore */ }
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[shopping_job_funnel] drop: ${batch.length} rows (reason: ${reason})`);
  } finally {
    if (client) {
      try {
        client.release();
      } catch { /* ignore */ }
    }
    flushInFlight = false;
  }
}

function scheduleFlush(pool: Pool): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushOnce(pool).catch((err) => {
      console.error('[shopping_job_funnel] flush error:', err);
    });
  }, FLUSH_INTERVAL_MS);
  if (typeof flushTimer.unref === 'function') flushTimer.unref();
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function startShoppingJobFunnel(pool: Pool = catalogDb): void {
  if (started) return;
  started = true;
  scheduleFlush(pool);
}

export async function stopShoppingJobFunnel(pool: Pool = catalogDb): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flushOnce(pool);
}

/**
 * Resolve the shopping_job_id for a tool call.
 * - If client supplies valid shopping_job_id, use it (is_replay = true)
 * - Otherwise, mint a new UUID (is_replay = false)
 */
export function resolveShoppingJobId(clientJobId: unknown, args: Record<string, unknown>): { jobId: string; isReplay: boolean } {
  if (isValidClientJobId(clientJobId)) {
    return { jobId: String(clientJobId), isReplay: true };
  }
  // For server-side minting, derive from product_name + deliver_to for stability
  const productName = args.product_name ?? args.q ?? '';
  const deliverTo = deriveDeliverTo(args);
  if (productName && deliverTo) {
    // Deterministic UUID from product + deliver_to (same logic as find_best_price_v2)
    const sessionKey = `${String(productName).toLowerCase()}|${deliverTo}`;
    try {
      const hash = createHash('sha1').update(sessionKey).digest();
      // Slice first 16 bytes of SHA-1 and set version/variant bits for UUID v5.
      const raw = Buffer.alloc(16);
      raw.set(hash.slice(0, 16), 0);
      raw[6] = (raw[6] & 0x0f) | 0x50; // version 5
      raw[8] = (raw[8] & 0x3f) | 0x80; // variant 10
      const hex = raw.toString('hex');
      return {
        jobId: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`,
        isReplay: false,
      };
    } catch { /* fall through to random */ }
  }
  return { jobId: randomUUID(), isReplay: false };
}

/**
 * Record a job_created stage — first buyer-intent call accepted.
 * Called at the start of every v2 buyer tool dispatch.
 */
export function recordJobCreated(input: {
  shoppingJobId: string;
  isReplay: boolean;
  toolName: string;
  args: Record<string, unknown>;
  apiKey: string | null | undefined;
}): void {
  const deliverTo = deriveDeliverTo(input.args);
  const isInternal = classifyIsInternal(input.apiKey);

  const row: ShoppingJobFunnelRow = {
    shopping_job_id: input.shoppingJobId,
    funnel_stage: 'job_created',
    tool_name: input.toolName,
    api_key_hash: hashApiKey(input.apiKey),
    deliver_to: deliverTo,
    country_code: deriveCountryCode(input.args),
    query_text: deriveQueryText(input.args),
    product_id: null,
    merchant_id: null,
    merchant_name: null,
    offer_url_present: false,
    is_internal: isInternal,
    is_replay: input.isReplay,
    stage_data: null,
    created_at: new Date(),
  };

  enqueueRow(row);
}

/**
 * Record a product_resolved stage — at least one concrete product id returned.
 */
export function recordProductResolved(input: {
  shoppingJobId: string;
  toolName: string;
  args: Record<string, unknown>;
  apiKey: string | null | undefined;
  result: unknown;
}): void {
  const deliverTo = deriveDeliverTo(input.args);
  const isInternal = classifyIsInternal(input.apiKey);
  const productIds = extractProductIds(input.result);
  const primaryProductId = productIds[0] ?? null;

  const row: ShoppingJobFunnelRow = {
    shopping_job_id: input.shoppingJobId,
    funnel_stage: 'product_resolved',
    tool_name: input.toolName,
    api_key_hash: hashApiKey(input.apiKey),
    deliver_to: deliverTo,
    country_code: deriveCountryCode(input.args),
    query_text: deriveQueryText(input.args),
    product_id: primaryProductId,
    merchant_id: null,
    merchant_name: null,
    offer_url_present: false,
    is_internal: isInternal,
    is_replay: false,
    stage_data: productIds.length > 1 ? { product_ids: productIds } : null,
    created_at: new Date(),
  };

  enqueueRow(row);
}

/**
 * Record an executable_offer_found stage — offer has merchant, price, deliverability.
 */
export function recordExecutableOfferFound(input: {
  shoppingJobId: string;
  toolName: string;
  args: Record<string, unknown>;
  apiKey: string | null | undefined;
  result: unknown;
}): void {
  const deliverTo = deriveDeliverTo(input.args);
  const isInternal = classifyIsInternal(input.apiKey);
  const productIds = extractProductIds(input.result);
  const primaryProductId = productIds[0] ?? null;
  const { merchant_id, merchant_name } = extractMerchantInfo(input.result);
  const hasOfferUrl = hasOutboundUrl(input.result);

  const row: ShoppingJobFunnelRow = {
    shopping_job_id: input.shoppingJobId,
    funnel_stage: 'executable_offer_found',
    tool_name: input.toolName,
    api_key_hash: hashApiKey(input.apiKey),
    deliver_to: deliverTo,
    country_code: deriveCountryCode(input.args),
    query_text: deriveQueryText(input.args),
    product_id: primaryProductId,
    merchant_id,
    merchant_name,
    offer_url_present: hasOfferUrl,
    is_internal: isInternal,
    is_replay: false,
    stage_data: null,
    created_at: new Date(),
  };

  enqueueRow(row);
}

/**
 * Record an outbound_link_returned stage — usable merchant/deal link in response.
 */
export function recordOutboundLinkReturned(input: {
  shoppingJobId: string;
  toolName: string;
  args: Record<string, unknown>;
  apiKey: string | null | undefined;
  result: unknown;
}): void {
  const deliverTo = deriveDeliverTo(input.args);
  const isInternal = classifyIsInternal(input.apiKey);
  const productIds = extractProductIds(input.result);
  const primaryProductId = productIds[0] ?? null;
  const { merchant_id, merchant_name } = extractMerchantInfo(input.result);
  const hasOfferUrl = hasOutboundUrl(input.result);

  const row: ShoppingJobFunnelRow = {
    shopping_job_id: input.shoppingJobId,
    funnel_stage: 'outbound_link_returned',
    tool_name: input.toolName,
    api_key_hash: hashApiKey(input.apiKey),
    deliver_to: deliverTo,
    country_code: deriveCountryCode(input.args),
    query_text: deriveQueryText(input.args),
    product_id: primaryProductId,
    merchant_id,
    merchant_name,
    offer_url_present: hasOfferUrl,
    is_internal: isInternal,
    is_replay: false,
    stage_data: null,
    created_at: new Date(),
  };

  enqueueRow(row);
}

function enqueueRow(row: ShoppingJobFunnelRow, pool: Pool = catalogDb): void {
  if (buffer.length >= MAX_BUFFER) {
    console.error(`[shopping_job_funnel] drop: buffer full (${MAX_BUFFER} rows), dropping row for job=${row.shopping_job_id} stage=${row.funnel_stage}`);
    return;
  }
  buffer.push(row);
  if (buffer.length === 1) {
    scheduleFlush(pool);
  }
}
