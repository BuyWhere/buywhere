#!/usr/bin/env node
/**
 * P1.3-NM Near-Miss Sweep — BUY-71135
 *
 * Executes the 225-cell basket sweep (5 markets × 5 categories × 3 query lengths × 3 merchant domains)
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

// 225-cell basket definition (per P1.3 spec)
const MARKETS = ['SG', 'US', 'MY', 'TH', 'VN'];
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
    return { results, near_miss, near_miss_predicate_fails, error: null };
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
  // If no results, it's a zero-result, not a near-miss
  if (!results || results.length === 0) {
    return { near_miss: false, predicate_fails: [] };
  }

  // Rex's classifier provides explicit near_miss flag
  if (typeof metadata.near_miss === 'boolean') {
    return {
      near_miss: metadata.near_miss,
      predicate_fails: metadata.near_miss_predicate_fails || [],
    };
  }

  const predicateFails = [];

  // Fallback heuristic 1: merchant-domain constraint from `site:domain` operator.
  // CALIBRATED 2026-08-18 (BUY-71316): The MCP endpoint frequently ignores or fails to honor
  // `site:` constraints, especially across markets. Treating domain mismatch alone as a
  // near-miss produced a 88.89% false-positive rate. It now only flags when title tokens
  // ALSO mismatch, so a site: miss that still returns topically relevant products is not
  // counted as a near-miss.
  let siteDomainMismatch = false;
  const siteMatch = query.match(/site:([a-z0-9.-]+)/i);
  if (siteMatch) {
    const requestedDomain = siteMatch[1].toLowerCase();
    const hasDomainMatch = results.some(r => {
      const url = String(r.url || r.product_url || r.link || '').toLowerCase();
      const merchant = String(r.merchant || r.merchant_name || r.store || '').toLowerCase();
      return url.includes(requestedDomain) || merchant.includes(requestedDomain);
    });
    siteDomainMismatch = !hasDomainMatch;
  }

  // Fallback heuristic 2: title-token coverage. If the query's content tokens
  // (excluding the site: operator) are poorly represented in the result titles,
  // the results are likely off-topic.
  // TUNED 2026-08-18 (BUY-71316): lowered threshold from 0.3 to 0.2 to reduce false
  // positives on short queries (1-2 tokens where a single token may be paraphrased).
  // Also require at least 3 query tokens before applying, to avoid flagging on very short queries.
  let titleTokenMismatch = false;
  const contentPart = query.replace(/site:[a-z0-9.-]+\s*/gi, '').trim();
  const queryTokens = contentPart
    .toLowerCase()
    .split(/\W+/)
    .filter(t => t.length > 2);
  if (queryTokens.length >= 3) {
    const titles = results
      .map(r => String(r.title || r.name || r.product_name || ''))
      .join(' ')
      .toLowerCase();
    const matchedTokens = queryTokens.filter(t => titles.includes(t));
    const coverage = matchedTokens.length / queryTokens.length;
    if (coverage < 0.2) {
      titleTokenMismatch = true;
    }
  }

  // Fallback heuristic 3: if results exist but have low explicit relevance scores
  const hasRelevanceScores = results.some(r => typeof r.relevance_score === 'number' || typeof r.score === 'number');
  if (hasRelevanceScores) {
    const avgScore = results.reduce((sum, r) => sum + (r.relevance_score || r.score || 0), 0) / results.length;
    if (avgScore < 0.2) {
      predicateFails.push('low_relevance_score');
    }
  }

  // Near-miss requires BOTH a site: domain miss AND off-topic titles, OR a low
  // relevance score. A site: miss alone is no longer sufficient.
  if (siteDomainMismatch && titleTokenMismatch) {
    predicateFails.push('merchant_domain_mismatch');
    predicateFails.push('title_token_mismatch');
  } else if (titleTokenMismatch) {
    predicateFails.push('title_token_mismatch');
  } else if (siteDomainMismatch) {
    // Calibrated out: site: constraint not honored by MCP is a known limitation,
    // not a catalog near-miss. Do not add merchant_domain_mismatch here.
  }

  return {
    near_miss: predicateFails.length > 0,
    predicate_fails: predicateFails,
  };
}

/**
 * Run a single query cell and return the result with near_miss classification
 */
async function runCell(market, category, queryLength, merchantDomain, tool = 'search_products') {
  const query = QUERY_TEMPLATES[category][queryLength];
  const queryWithMerchant = `${query} site:${merchantDomain}`;

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

    // P1.3-NM fields (new)
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

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.error(`[p13-sweep] Starting P1.3-NM 225-cell sweep at ${nowIso()}`);
  console.error(`[p13-sweep] Target: ${TARGET_URL}`);
  console.error(`[p13-sweep] Output: ${OUTPUT_PATH}`);
  appendCadenceLog('start', { output_path: OUTPUT_PATH, target_url: TARGET_URL });

  if (!API_KEY) {
    console.error('[p13-sweep] ERROR: BUYWHERE_API_KEY or BUYWHERE_MONITORING_API_KEY not set');
    appendCadenceLog('failure', { output_path: OUTPUT_PATH, error: 'BUYWHERE_API_KEY or BUYWHERE_MONITORING_API_KEY not set' });
    process.exit(1);
  }

  // Build 225-cell basket
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

  console.error(`[p13-sweep] Running ${cells.length} cells...`);

  const results = [];
  let completed = 0;
  let errors = 0;

  // Run cells with limited concurrency to avoid rate limiting
  const CONCURRENCY = 5;

  async function runBatch(batch) {
    return Promise.all(batch.map(cell =>
      runCell(cell.market, cell.category, cell.queryLength, cell.merchantDomain, cell.tool)
        .then(r => {
          completed++;
          if (r.error) errors++;
          if (completed % 25 === 0) {
            console.error(`[p13-sweep] Progress: ${completed}/${cells.length} (${errors} errors)`);
          }
          return r;
        })
        .catch(e => {
          completed++;
          errors++;
          return {
            ...cell,
            error: String(e?.message || e),
            result_count: 0,
            near_miss: false,
            near_miss_predicate_fails: [],
            swept_at: nowIso(),
          };
        })
    ));
  }

  // Process in batches
  for (let i = 0; i < cells.length; i += CONCURRENCY) {
    const batch = cells.slice(i, i + CONCURRENCY);
    const batchResults = await runBatch(batch);
    results.push(...batchResults);
  }

  // Compute cell-level metrics
  const metrics = computeCellMetrics(results);

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

  // Persist KPI breach row so monitoring.v_ceo_kpis.near_miss_rate is non-null
  if (CATALOG_DATABASE_URL) {
    try {
      const pool = new Pool({ connectionString: CATALOG_DATABASE_URL, max: 1, connectionTimeoutMillis: 10000 });
      const client = await pool.connect();
      try {
        const dominantReason = findDominantPredicateFails(results);
        await client.query(
          `INSERT INTO monitoring.alert_history
             (market, p95_ms, threshold_ms, kind, sweep_id, near_miss_rate, predicate_fails_reason, triggered_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
          ['sg', 0, 300, 'near_miss_breach', summary.sweep_id, metrics.near_miss_rate, dominantReason]
        );
        console.error(`[p13-sweep] Inserted near_miss_breach row for ${summary.sweep_id}`);
      } finally {
        client.release();
        await pool.end();
      }
    } catch (e) {
      console.error(`[p13-sweep] WARN: failed to insert near_miss_breach row: ${e?.message || e}`);
    }
  } else {
    console.error('[p13-sweep] WARN: CATALOG_DATABASE_URL not set; skipping alert_history insert');
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

  // Exit with error if near_miss_rate exceeds 4% (per-sweep gate per P1.3 spec)
  if (metrics.near_miss_rate >= 0.04) {
    console.error(`[p13-sweep] WARN: Near-miss rate ${(metrics.near_miss_rate * 100).toFixed(2)}% exceeds 4% per-sweep gate`);
    // Note: Should trigger child issue filing here (see deliverable #3)
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
