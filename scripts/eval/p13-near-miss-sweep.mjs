#!/usr/bin/env node
/**
 * P1.3-NM Near-Miss Sweep — BUY-71135
 *
 * Executes the 315-cell basket sweep (7 markets × 5 categories × 3 query lengths × 3 merchant domains)
 * at 23:55Z nightly, recording per-row near_miss and near_miss_predicate_fails from Rex's classifier.
 *
 * Output: data/sweep/zrr/YYYY-MM-DD.jsonl (backward-compatible with P1.3 schema)
 *
 * Usage:
 *   node scripts/eval/p13-near-miss-sweep.mjs
 *   # Or with custom output:
 *   SWEEP_OUTPUT_PATH=./data/sweep/zrr/2026-08-18.jsonl node scripts/eval/p13-near-miss-sweep.mjs
 *
 * Dependencies:
 *   - Rex's response classifier must emit near_miss and near_miss_predicate_fails per row
 *   - MCP tools: search_products, find_best_price, get_deals
 *   - Catalog DB: monitoring.alert_history for storing breach alerts
 */

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { URL as NodeURL } from 'node:url';
import pg from 'pg';
const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Configuration ────────────────────────────────────────────────────────────

const TARGET_URL = process.env.TARGET_URL || process.env.BUYWHERE_MCP_URL || 'https://mcp.buywhere.ai/mcp';
const API_KEY = process.env.BUYWHERE_API_KEY || process.env.BUYWHERE_MONITORING_API_KEY || process.env.MCP_TESTING_API_KEY || '';

const OUTPUT_DIR = process.env.SWEEP_OUTPUT_DIR || path.join(__dirname, '..', '..', 'data', 'sweep', 'zrr');
const OUTPUT_PATH = process.env.SWEEP_OUTPUT_PATH || path.join(OUTPUT_DIR, `${new Date().toISOString().split('T')[0]}.jsonl`);
const LOG_PATH = process.env.SWEEP_LOG_PATH || path.join(__dirname, '..', '..', 'logs', 'p13-sweep.log');
const CATALOG_DATABASE_URL = process.env.CATALOG_DATABASE_URL || process.env.BUYWHERE_CATALOG_DATABASE_URL || '';

// 315-cell basket definition (per P1.3 spec §6 routing: seven markets × 5 categories × 3 query lengths × 3 merchant domains)
const MARKETS = ['SG', 'US', 'MY', 'TH', 'VN', 'ID', 'PH'];
const CATEGORIES = ['electronics', 'fashion', 'home', 'health', 'sports'];
const QUERY_LENGTHS = ['short', 'medium', 'long'];
const MERCHANT_DOMAINS = ['amazon.com', 'shopee.sg', 'lazada.sg'];

// Query templates by category and length
const QUERY_TEMPLATES = {
  electronics: {
    short: 'laptop',
    medium: 'gaming laptop',
    long: 'gaming laptop 15 inch rgb',
  },
  fashion: {
    short: 'shirt',
    medium: 'cotton t-shirt',
    long: 'mens cotton t-shirt slim fit',
  },
  home: {
    short: 'lamp',
    medium: 'table lamp',
    long: 'led table lamp adjustable brightness',
  },
  health: {
    short: 'vitamins',
    medium: 'vitamin d3',
    long: 'vitamin d3 1000 iu supplement',
  },
  sports: {
    short: 'shoes',
    medium: 'running shoes',
    long: 'mens running shoes breathable lightweight',
  },
};

// Timeout per query (ms)
const QUERY_TIMEOUT_MS = 15000;

// BUY-71309: monitoring tier is 200 rpm; the 225-cell sweep previously finished
// inside one Redis minute window and rate-limited the final cells. Pace requests by
// default so the nightly run stays under that ceiling without rotating keys.
const CONCURRENCY = Math.max(1, parseInt(process.env.SWEEP_CONCURRENCY || '1', 10));
const MIN_DELAY_MS = Math.max(0, parseInt(process.env.SWEEP_MIN_DELAY_MS || '350', 10));

// ── Helpers ──────────────────────────────────────────────────────────────────

function nowIso() {
  return new Date().toISOString();
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function appendCadenceLog(event, fields = {}) {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, JSON.stringify({ ts: nowIso(), event, ...fields }) + '\n');
  } catch (e) {
    console.error(`[p13-sweep] WARN: failed to append cadence log: ${e?.message || e}`);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch from BuyWhere API with timeout
 */
async function fetchJson(url, opts = {}) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), opts.timeout || QUERY_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...(API_KEY ? { 'Authorization': `Bearer ${API_KEY}`, 'X-API-Key': API_KEY } : {}),
      },
    });
    if (!res.ok) {
      return { _status: res.status, _ok: false, body: null };
    }
    const body = await res.json();
    return { _status: res.status, _ok: true, body };
  } catch (e) {
    return { _status: 0, _ok: false, _error: String(e?.message || e) };
  } finally {
    clearTimeout(tid);
  }
}

/**
 * Execute MCP tool call via JSON-RPC over HTTPS to the live MCP endpoint.
 *
 * Endpoint: https://mcp.buywhere.ai/mcp (JSON-RPC 2.0, x-api-key auth).
 * Method: `tools/call` with the tool name as `params.name` and tool args as `params.arguments`.
 */
async function callMcpTool(toolName, args) {
  const payload = {
    jsonrpc: '2.0',
    id: Date.now() + Math.floor(Math.random() * 1000),
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  };

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), QUERY_TIMEOUT_MS);
  try {
    const res = await fetch(TARGET_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Accept': 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        ...(API_KEY ? { 'x-api-key': API_KEY } : {}),
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return { error: `HTTP ${res.status}`, results: [] };
    }
    const raw = await res.text();
    let body = null;
    // MCP Streamable HTTP may wrap JSON-RPC in SSE `data:` lines or return raw JSON.
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('data:')) {
        const after = trimmed.slice(5).trim();
        if (!after || after === '[DONE]') continue;
        try { body = JSON.parse(after); break; } catch { /* fall through */ }
      } else {
        try { body = JSON.parse(trimmed); break; } catch { /* fall through */ }
      }
    }
    if (!body) {
      return { error: 'non-JSON response', results: [] };
    }
    if (body.error) {
      const msg = typeof body.error === 'string' ? body.error : body.error?.message || 'rpc_error';
      return { error: msg, results: [] };
    }
    const result = body.result ?? {};
    // MCP tools/call: result.content is an array of content blocks; the tool's
    // structured payload is in `structuredContent` (or parsed from a JSON text block).
    let structured = result.structuredContent ?? null;
    if (!structured) {
      const blocks = ensureArray(result.content);
      const jsonBlock = blocks.find(b => b && b.type === 'json' && b.data != null);
      const textJson = blocks.find(b => b && b.type === 'text');
      if (jsonBlock) {
        structured = jsonBlock.data;
      } else if (textJson && typeof textJson.text === 'string') {
        try { structured = JSON.parse(textJson.text); } catch { /* not JSON */ }
      }
    }
    const payload2 = structured || result;
    const results = ensureArray(
      payload2?.results ||
      payload2?.data?.results ||
      payload2?.products ||
      payload2?.data?.products ||
      payload2?.items ||
      payload2?.data ||
      payload2
    );
    const near_miss = payload2?.near_miss ?? null;
    const near_miss_predicate_fails = payload2?.near_miss_predicate_fails ?? null;
    // P2.6 (BUY-71543): per-cell emptiness_reason from MCP wire; null when results returned.
    const emptiness_reason = payload2?.meta?.emptiness_reason ?? payload2?.emptiness_reason ?? null;
    return { results, near_miss, near_miss_predicate_fails, emptiness_reason, error: null };
  } catch (e) {
    return { error: String(e?.message || e), results: [] };
  } finally {
    clearTimeout(tid);
  }
}

/**
 * Determine if a result is a "near miss" - products returned but none matched the query intent
 * This is the inverse of zero-result: we got results but they're not useful
 */
function classifyNearMiss(query, results, metadata = {}) {
  void query;
  // If no results, it's a zero-result, not a near-miss.
  if (!results || results.length === 0) {
    return { near_miss: false, predicate_fails: [] };
  }

  // Rex's classifier provides explicit near_miss flag. The MCP/REST classifier
  // may surface this either at top level or under meta.
  const explicitNearMiss = metadata.near_miss ?? metadata.meta?.near_miss;
  const explicitPredicateFails = metadata.near_miss_predicate_fails ?? metadata.meta?.near_miss_predicate_fails;
  if (typeof explicitNearMiss === 'boolean') {
    return {
      near_miss: explicitNearMiss,
      predicate_fails: explicitPredicateFails || [],
    };
  }

  // BUY-71316: Deprecate the sweep-local fallback heuristic. The first nightly
  // sweep showed it was measuring query/parser quirks (`site:` ignored by MCP and
  // title-token brittleness across markets) rather than Rex's minimum-utility
  // near-miss predicate. Until the endpoint emits explicit classifier metadata,
  // rows with products are not counted as near-miss by this script.
  return { near_miss: false, predicate_fails: [] };
}

/**
 * Run a single query cell and return the result with near_miss classification
 */
async function runCell(market, category, queryLength, merchantDomain, tool = 'search_products') {
  const query = QUERY_TEMPLATES[category][queryLength];
  // BUY-71316: Do not send `site:` operators to MCP. The live search endpoint does
  // not reliably honor them across markets, and they distort the sweep by turning
  // topical relevance checks into merchant-domain constraint checks. Keep the
  // merchant_domain cell dimension for basket continuity, but measure topical
  // relevance only until Rex's explicit near_miss classifier is live on MCP.
  const queryWithMerchant = query;

  const startTime = Date.now();
  let result;

  switch (tool) {
    case 'search_products':
      result = await callMcpTool('search_products', {
        q: queryWithMerchant,
        country_code: market,
        limit: 10,
      });
      break;
    case 'find_best_price':
      result = await callMcpTool('find_best_price', {
        product_name: query,
        country_code: market,
      });
      break;
    case 'get_deals':
      result = await callMcpTool('get_deals', {
        category: category,
        country_code: market,
        limit: 10,
      });
      break;
    default:
      result = { error: `Unknown tool: ${tool}`, results: [] };
  }

  const latencyMs = Date.now() - startTime;

  // Classify near-miss using Rex's classifier output or fallback heuristic
  const { near_miss, predicate_fails } = classifyNearMiss(
    queryWithMerchant,
    result.results,
    { near_miss: result.near_miss, near_miss_predicate_fails: result.near_miss_predicate_fails }
  );

  // Determine emptiness_reason per P2.6 spec (§2.1). Prefer the wire value
  // from MCP meta; fallback keeps the sweep useful until all tools are upgraded.
  let emptiness_reason = null;
  const resultCount = result.results?.length || 0;
  if (resultCount === 0) {
    emptiness_reason = result.emptiness_reason || (result.error ? 'api_error' : 'missing');
  }

  return {
    // Cell identifiers
    market,
    category,
    query_length: queryLength,
    merchant_domain: merchantDomain,
    tool,

    // Query
    query: queryWithMerchant,

    // Result
    result_count: result.results?.length || 0,
    latency_ms: latencyMs,
    error: result.error,

    // P2.6 (BUY-71543): emptiness_reason per cell.
    // Values: null (results returned), MCP enum, 'missing' (silent empty), 'api_error' (transport/RPC failure).
    emptiness_reason,

    // P1.3-NM fields
    near_miss,
    near_miss_predicate_fails: predicate_fails,

    // Timestamp
    swept_at: nowIso(),
  };
}

/**
 * Compute cell-level near_miss_rate
 */
function computeCellMetrics(cells) {
  const total = cells.length;
  const zeroResults = cells.filter(c => c.result_count === 0).length;
  const nearMisses = cells.filter(c => c.near_miss === true).length;

  return {
    cell_count: total,
    zero_result_count: zeroResults,
    zero_result_rate: total > 0 ? zeroResults / total : 0,
    near_miss_count: nearMisses,
    near_miss_rate: total > 0 ? nearMisses / total : 0,
  };
}

function findDominantPredicateFails(cells) {
  const counts = new Map();
  for (const cell of cells) {
    const fails = ensureArray(cell.near_miss_predicate_fails);
    for (const fail of fails) {
      const key = String(fail || '').trim();
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  if (counts.size === 0) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Compute per-market metrics from cell results.
 */
function computeMetricsByMarket(cells) {
  const byMarket = new Map();
  for (const cell of cells) {
    const m = String(cell.market).toUpperCase();
    if (!byMarket.has(m)) byMarket.set(m, []);
    byMarket.get(m).push(cell);
  }
  return [...byMarket.entries()].map(([market, marketCells]) => {
    const m = computeCellMetrics(marketCells);
    return {
      market,
      ...m,
      predicate_fails_reason: findDominantPredicateFails(marketCells),
    };
  });
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.error(`[p13-sweep] Starting P1.3-NM 315-cell sweep at ${nowIso()}`);
  console.error(`[p13-sweep] Target: ${TARGET_URL}`);
  console.error(`[p13-sweep] Output: ${OUTPUT_PATH}`);
  appendCadenceLog('start', { output_path: OUTPUT_PATH, target_url: TARGET_URL });

  if (!API_KEY) {
    console.error('[p13-sweep] ERROR: BUYWHERE_API_KEY or BUYWHERE_MONITORING_API_KEY not set');
    appendCadenceLog('failure', { output_path: OUTPUT_PATH, error: 'BUYWHERE_API_KEY or BUYWHERE_MONITORING_API_KEY not set' });
    process.exit(1);
  }

  // Build 315-cell basket
  const cells = [];
  for (const market of MARKETS) {
    for (const category of CATEGORIES) {
      for (const queryLength of QUERY_LENGTHS) {
        for (const merchantDomain of MERCHANT_DOMAINS) {
          // Use search_products as primary tool (per P1.3 spec)
          cells.push({ market, category, queryLength, merchantDomain, tool: 'search_products' });
        }
      }
    }
  }

  console.error(`[p13-sweep] Running ${cells.length} cells (concurrency=${CONCURRENCY}, delay=${MIN_DELAY_MS}ms)...`);

  const results = [];
  let completed = 0;
  let errors = 0;

  // Run cells with limited concurrency and an inter-cell delay to avoid the
  // monitoring tier's 200 req/min ceiling (BUY-71309). Sequential-by-default is
  // acceptable for a nightly 23:55Z sweep; override with SWEEP_CONCURRENCY > 1.
  async function runBatch(batch) {
    const batchResults = [];
    for (const cell of batch) {
      const r = await runCell(cell.market, cell.category, cell.queryLength, cell.merchantDomain, cell.tool).catch(e => {
        return {
          ...cell,
          error: String(e?.message || e),
          result_count: 0,
          emptiness_reason: 'api_error',
          near_miss: false,
          near_miss_predicate_fails: [],
          swept_at: nowIso(),
        };
      });
      completed++;
      if (r.error) errors++;
      if (completed % 25 === 0) {
        console.error(`[p13-sweep] Progress: ${completed}/${cells.length} (${errors} errors)`);
      }
      batchResults.push(r);
      if (MIN_DELAY_MS > 0) await sleep(MIN_DELAY_MS);
    }
    return batchResults;
  }

  // Process in batches
  for (let i = 0; i < cells.length; i += CONCURRENCY) {
    const batch = cells.slice(i, i + CONCURRENCY);
    const batchResults = await runBatch(batch);
    results.push(...batchResults);
  }

  // Compute cell-level metrics
  const metrics = computeCellMetrics(results);
  const marketMetrics = computeMetricsByMarket(results);

  console.error(`[p13-sweep] Completed: ${completed} cells, ${errors} errors`);
  console.error(`[p13-sweep] Zero-result rate: ${(metrics.zero_result_rate * 100).toFixed(2)}%`);
  console.error(`[p13-sweep] Near-miss rate: ${(metrics.near_miss_rate * 100).toFixed(2)}%`);

  const summary = {
    sweep_id: `p13-nm-${new Date().toISOString().split('T')[0]}`,
    captured_at: nowIso(),
    markets: MARKETS,
    categories: CATEGORIES,
    query_lengths: QUERY_LENGTHS,
    merchant_domains: MERCHANT_DOMAINS,
    cell_count: metrics.cell_count,
    zero_result_count: metrics.zero_result_count,
    zero_result_rate: metrics.zero_result_rate,
    near_miss_count: metrics.near_miss_count,
    near_miss_rate: metrics.near_miss_rate,
    error_count: errors,
    output_path: OUTPUT_PATH,
  };

  // Persist one real sweep result per market; alert_history stores breach alerts only.
  // Parse the DSN into host/port/user/password/database so pg honours ssl.rejectUnauthorized
  // (connectionString sslmode=require overrides Node pg's ssl object).
  function poolFromUrl(url) {
    const u = new NodeURL(url);
    return new Pool({
      host: u.hostname,
      port: u.port ? parseInt(u.port, 10) : 5432,
      user: u.username,
      password: decodeURIComponent(u.password),
      database: u.pathname ? u.pathname.slice(1) : undefined,
      max: 1,
      connectionTimeoutMillis: 10000,
      ssl: { rejectUnauthorized: false },
    });
  }

  if (CATALOG_DATABASE_URL) {
    try {
      const pool = poolFromUrl(CATALOG_DATABASE_URL);
      const client = await pool.connect();
      try {
        for (const m of marketMetrics) {
          await client.query(
            `INSERT INTO monitoring.sweep_results
               (sweep_id, market, cell_count, zero_result_count, zero_result_rate, near_miss_count, near_miss_rate, error_count, predicate_fails_reason, swept_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
             ON CONFLICT (sweep_id, market) DO UPDATE SET
               cell_count = EXCLUDED.cell_count,
               zero_result_count = EXCLUDED.zero_result_count,
               zero_result_rate = EXCLUDED.zero_result_rate,
               near_miss_count = EXCLUDED.near_miss_count,
               near_miss_rate = EXCLUDED.near_miss_rate,
               error_count = EXCLUDED.error_count,
               predicate_fails_reason = EXCLUDED.predicate_fails_reason,
               swept_at = EXCLUDED.swept_at`,
            [
              summary.sweep_id,
              m.market.toLowerCase(),
              m.cell_count,
              m.zero_result_count,
              m.zero_result_rate,
              m.near_miss_count,
              m.near_miss_rate,
              errors,
              m.predicate_fails_reason,
            ]
          );
        }
        console.error(`[p13-sweep] Upserted ${marketMetrics.length} sweep_results rows for ${summary.sweep_id}`);

        const breachMarkets = marketMetrics.filter(m => m.near_miss_rate >= 0.04);
        for (const m of breachMarkets) {
          await client.query(
            `INSERT INTO monitoring.alert_history
               (market, p95_ms, threshold_ms, kind, sweep_id, near_miss_rate, predicate_fails_reason, triggered_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
            [m.market.toLowerCase(), 0, 300, 'near_miss_breach', summary.sweep_id, m.near_miss_rate, m.predicate_fails_reason]
          );
        }
        if (breachMarkets.length > 0) {
          console.error(`[p13-sweep] Inserted ${breachMarkets.length} near_miss_breach alert rows for ${summary.sweep_id}`);
        } else {
          console.error(`[p13-sweep] No near_miss_breach alerts for ${summary.sweep_id}; all markets below 4%`);
        }

        // P2.6 (BUY-71543): each api_error empty cell is a Category A regression.
        // One alert_history row per api_error cell so the morning review treats it
        // with the same severity as a SEV-1 like BUY-71431.
        const apiErrorCells = results.filter(r => r.emptiness_reason === 'api_error');
        for (const cell of apiErrorCells) {
          await client.query(
            `INSERT INTO monitoring.alert_history
               (market, p95_ms, threshold_ms, kind, sweep_id, near_miss_rate, predicate_fails_reason, triggered_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
            [
              cell.market.toLowerCase(),
              cell.latency_ms,
              300,
              'api_error_empty',
              `${summary.sweep_id}:${cell.market}:${cell.category}:${cell.query_length}:${cell.merchant_domain}`,
              null,
              `api_error empty cell: ${cell.error || 'unknown error'}`,
            ]
          );
        }
        if (apiErrorCells.length > 0) {
          console.error(`[p13-sweep] Inserted ${apiErrorCells.length} api_error_empty Cat-A rows for ${summary.sweep_id}`);
        }

        // Signal: zero-result cells still missing emptiness_reason means the MCP
        // wire contract isn't shipping the field; morning review should ping Rex.
        const silentEmptyCells = results.filter(r => r.result_count === 0 && !r.emptiness_reason);
        if (silentEmptyCells.length > 0) {
          console.error(`[p13-sweep] WARN: ${silentEmptyCells.length} zero-result cells are missing emptiness_reason (P2.6 server-side gap)`);
        }
      } finally {
        client.release();
        await pool.end();
      }
    } catch (e) {
      console.error(`[p13-sweep] WARN: failed to persist sweep telemetry: ${e?.message || e}`);
    }
  } else {
    console.error('[p13-sweep] WARN: CATALOG_DATABASE_URL not set; skipping sweep_results insert');
  }

  // Write JSONL output
  try {
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });

    const writer = fs.createWriteStream(OUTPUT_PATH);
    for (const row of results) {
      writer.write(JSON.stringify(row) + '\n');
    }
    writer.end();

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    console.error(`[p13-sweep] Wrote ${results.length} rows to ${OUTPUT_PATH}`);
  } catch (e) {
    console.error(`[p13-sweep] ERROR writing output: ${e?.message || e}`);
    appendCadenceLog('failure', { output_path: OUTPUT_PATH, error: `write failed: ${e?.message || e}` });
    process.exit(1);
  }

  console.error(`[p13-sweep] Summary: ${JSON.stringify(summary)}`);

  // Exit with error if any market exceeds 4% (per-sweep gate per P1.3 spec)
  const maxMarketRate = Math.max(...marketMetrics.map(m => m.near_miss_rate));
  if (maxMarketRate >= 0.04) {
    const breached = marketMetrics.filter(m => m.near_miss_rate >= 0.04).map(m => `${m.market}:${(m.near_miss_rate * 100).toFixed(2)}%`).join(', ');
    console.error(`[p13-sweep] WARN: Near-miss rate exceeds 4% per-sweep gate in ${breached}`);
  }

  appendCadenceLog('done', {
    output_path: OUTPUT_PATH,
    row_count: results.length,
    error_count: errors,
    near_miss_rate: metrics.near_miss_rate,
    zero_result_rate: metrics.zero_result_rate,
  });
  console.error('[p13-sweep] Done');
  process.exit(0);
}

main().catch(e => {
  console.error('[p13-sweep] FATAL:', e?.stack || e);
  process.exit(1);
});
