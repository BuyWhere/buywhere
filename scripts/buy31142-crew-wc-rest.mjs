#!/usr/bin/env node
// @title BUY-31142 Crew REST sub-lane worker (BUY-38482 keep-alive target)
//
// Deep-pages known WooCommerce (WC) merchants from
//   data/buy31015-wc-known-merchants.json
// hitting, per domain:
//   1. /wp-json/wc/store/products  (public Store API — no auth)
//   2. /wp-json/wc/v3/products      (WC v3 REST — basic auth if creds present)
// Normalizes each product and upserts into maglev.products via
//   POST {INGEST_API_URL}/v1/ingest  with source = "woocommerce_deep".
//
// Lifecycle (operated by scripts/buy31142-crew-wc-rest-keep-alive.sh):
//   - Runs for --duration-sec seconds (default 240), then exits 0 so the
//     keep-alive tick can respawn a fresh worker before the heartbeat cgroup
//     kill fires. This is the sub-5-min keep-alive contract.
//   - Writes a pidfile + heartbeat on start and after every page so the
//     keep-alive can tell a live worker from a dead/stalled one.
//
// Target: >= 5k rows/hr sustained. Run many sweeps within the duration window.

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.WC_LANE_STATE_DIR || path.join(REPO_ROOT, 'data');

const MERCHANTS_PATH = process.env.WC_KNOWN_MERCHANTS_PATH
  || path.join(DATA_DIR, 'buy31015-wc-known-merchants.json');

const PIDFILE = path.join(DATA_DIR, 'buy31142-crew-wc-rest.pid');
const HEARTBEATFILE = path.join(DATA_DIR, 'buy31142-crew-wc-rest.heartbeat');
const STATUSFILE = path.join(DATA_DIR, 'buy31142-crew-wc-rest-status.json');

const INGEST_SOURCE = 'woocommerce_deep';

const INGEST_API_URL = (process.env.INGEST_API_URL
  || process.env.BUYWHERE_API_URL
  || 'http://localhost:8000').replace(/\/$/, '');
const INGEST_API_KEY = process.env.BUYWHERE_API_KEY || '';

// Optional WC v3 REST credentials (global). Per-merchant creds can be supplied
// in the merchants file via consumer_key / consumer_secret fields.
const WC_CONSUMER_KEY = process.env.WC_CONSUMER_KEY || '';
const WC_CONSUMER_SECRET = process.env.WC_CONSUMER_SECRET || '';

const PER_PAGE = 100;        // WC max per_page for both endpoints
const MAX_PAGES = 20;        // cap pages per merchant per visit (deep-page, not infinite)
const INGEST_BATCH = 500;    // <= 1000 hard limit on /v1/ingest; batch smaller for throughput
const REQUEST_TIMEOUT_MS = 15000;
const POLITENESS_MS = 100;   // small delay between WC requests
const TARGET_ROWS_PER_HOUR = 5000;

const startedAtMs = Date.now();
let shuttingDown = false;
const runStats = {
  sweeps: 0,
  merchantsVisited: 0,
  pagesFetched: 0,
  productsSeen: 0,
  rowsInserted: 0,
  rowsUpdated: 0,
  rowsFailed: 0,
  batches: 0,
  ingestErrors: 0,
};
let rateLimitState = null;

function nowIso() {
  return new Date().toISOString();
}

function log(level, message, extra) {
  const line = `[crew-wc-rest ${nowIso()}] [${level}] ${message}`;
  console[level === 'error' ? 'error' : 'log'](extra ? `${line} ${JSON.stringify(extra)}` : line);
}
const info = (m, e) => log('info', m, e);
const warn = (m, e) => log('warn', m, e);
const errorLog = (m, e) => log('error', m, e);

function parseArgs(argv) {
  const out = { durationSec: 240, maxRows: 0, once: false, dryRun: false, list: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--duration-sec') out.durationSec = parseInt(argv[++i], 10) || out.durationSec;
    else if (a.startsWith('--duration-sec=')) out.durationSec = parseInt(a.split('=')[1], 10) || out.durationSec;
    else if (a === '--max-rows') out.maxRows = parseInt(argv[++i], 10) || 0;
    else if (a.startsWith('--max-rows=')) out.maxRows = parseInt(a.split('=')[1], 10) || 0;
    else if (a === '--once') out.once = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--list') out.list = true;
    else if (a === '-h' || a === '--help') {
      console.log(`Usage: buy31142-crew-wc-rest.mjs [--duration-sec=240] [--max-rows=N] [--once] [--dry-run] [--list]
  --duration-sec  run window in seconds (default 240; keep-alive respawns before cgroup kill)
  --max-rows      stop after N ingested rows (0 = unlimited)
  --once          a single sweep over the merchant list, then exit
  --dry-run       fetch + normalize but do not POST to /v1/ingest
  --list          print the loaded merchant list and exit
Env: INGEST_API_URL, BUYWHERE_API_KEY, WC_CONSUMER_KEY, WC_CONSUMER_SECRET,
     WC_KNOWN_MERCHANTS_PATH, WC_LANE_STATE_DIR`);
      process.exit(0);
    }
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadMerchants() {
  if (!existsSync(MERCHANTS_PATH)) {
    console.error(`[wc-rest] WARNING: merchants file not found at ${MERCHANTS_PATH} — returning empty list`);
    return [];
  }
  const raw = await fs.readFile(MERCHANTS_PATH, 'utf8');
  const data = JSON.parse(raw);
  const list = Array.isArray(data) ? data : (data.merchants || []);
  return list
    .filter((m) => m && typeof m.domain === 'string')
    .map((m) => ({
      domain: m.domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase(),
      country: m.country || 'US',
      currency: m.currency || 'USD',
      category: m.category || '',
      consumer_key: m.consumer_key || '',
      consumer_secret: m.consumer_secret || '',
    }));
}

async function fetchJson(url, { headers = {}, timeoutMs = REQUEST_TIMEOUT_MS, method, body: requestBody } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const opts = { headers, signal: ctrl.signal, redirect: 'follow' };
    if (method) opts.method = method;
    if (requestBody !== undefined) {
      opts.body = typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody);
    }
    const res = await fetch(url, opts);
    const ctype = res.headers.get('content-type') || '';
    if (!ctype.includes('json')) {
      // Not a WC JSON surface (often an HTML 404 / homepage for non-Woo domains).
      const text = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: `non-json content-type (${ctype})`, sample: text.slice(0, 120) };
    }
    const responseBody = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, status: res.status, error: `http ${res.status}`, body: responseBody };
    }
    return { ok: true, status: res.status, body: responseBody };
  } catch (err) {
    const msg = err && err.name === 'AbortError' ? 'timeout' : String(err && err.message || err);
    return { ok: false, status: 0, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

function wcAuthHeader(merchant) {
  const key = merchant.consumer_key || WC_CONSUMER_KEY;
  const secret = merchant.consumer_secret || WC_CONSUMER_SECRET;
  if (!key || !secret) return null;
  const token = Buffer.from(`${key}:${secret}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

function asNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// Store API (/wc/store/products): prices are minor-unit strings (cents for USD).
function normalizeStoreProduct(p, merchant) {
  const prices = p && typeof p === 'object' ? p.prices : null;
  const minorUnits = (prices && Number.isFinite(Number(prices.currency_minor_units)))
    ? Number(prices.currency_minor_units) : 2;
  const rawPrice = prices ? (prices.sale_price || prices.price || prices.regular_price) : null;
  const price = asNumber(rawPrice);
  // Convert minor units -> major units (e.g. cents -> dollars).
  const major = price !== null && minorUnits > 0 ? price / Math.pow(10, minorUnits) : price;
  const name = p.name || p.title || '';
  const permalink = p.permalink || (p.permalink === '' ? '' : '');
  const sku = p.sku || '';
  const id = p.id != null ? String(p.id) : '';
  return {
    sku: sku || `wc-${merchant.domain}-${id}`,
    merchant_id: merchant.domain,
    title: name,
    price: major != null ? major : 0,
    currency: (prices && prices.currency_code) || merchant.currency,
    url: permalink || `https://${merchant.domain}/?p=${id}`,
    image_url: (Array.isArray(p.images) && p.images[0] && (p.images[0].src || p.images[0].thumbnail)) || (p.thumbnail || '') || undefined,
    category: (Array.isArray(p.categories) && p.categories[0] && p.categories[0].name) || merchant.category || undefined,
    brand: undefined,
    in_stock: p.stock_status ? p.stock_status === 'instock' : undefined,
    availability: p.stock_status || undefined,
    country_code: merchant.country,
    is_active: true,
    metadata: { wc_endpoint: 'store', wc_id: id, wc_type: p.type || undefined },
  };
}

// v3 API (/wc/v3/products): price is a major-unit string.
function normalizeV3Product(p, merchant) {
  const name = p.name || '';
  const sku = p.sku || '';
  const id = p.id != null ? String(p.id) : '';
  const price = asNumber(p.sale_price || p.price || p.regular_price);
  const permalink = p.permalink || '';
  return {
    sku: sku || `wc-${merchant.domain}-${id}`,
    merchant_id: merchant.domain,
    title: name,
    price: price != null ? price : 0,
    currency: merchant.currency,
    url: permalink || `https://${merchant.domain}/?p=${id}`,
    image_url: (Array.isArray(p.images) && p.images[0] && p.images[0].src) || undefined,
    category: (Array.isArray(p.categories) && p.categories[0] && p.categories[0].name) || merchant.category || undefined,
    brand: undefined,
    in_stock: p.stock_status ? p.stock_status === 'instock' : undefined,
    availability: p.stock_status || undefined,
    country_code: merchant.country,
    is_active: p.status ? p.status === 'publish' : true,
    metadata: { wc_endpoint: 'v3', wc_id: id, wc_type: p.type || undefined },
  };
}

function clean(product) {
  // Drop undefined keys so the ingest payload stays compact.
  const out = {};
  for (const [k, v] of Object.entries(product)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

async function ingestBatch(products) {
  if (!products.length) return;
  runStats.batches += 1;
  if (args.dryRun) {
    runStats.productsSeen += products.length;
    info('dry-run ingest (skipped POST)', { batch: products.length });
    return;
  }
  if (!INGEST_API_KEY) {
    warn('no BUYWHERE_API_KEY — cannot POST /v1/ingest (use --dry-run to exercise fetch only)', { count: products.length });
    runStats.rowsFailed += products.length;
    runStats.ingestErrors += 1;
    return;
  }
  const url = `${INGEST_API_URL}/v1/ingest`;
  const started = Date.now();
  const res = await fetchJson(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${INGEST_API_KEY}`,
    },
    body: { source: INGEST_SOURCE, products },
    timeoutMs: 30000,
  });
  const latency = Date.now() - started;
  if (res.ok && res.body) {
    const inserted = Number(res.body.rows_inserted) || 0;
    const updated = Number(res.body.rows_updated) || 0;
    const failed = Number(res.body.rows_failed) || 0;
    runStats.rowsInserted += inserted;
    runStats.rowsUpdated += updated;
    runStats.rowsFailed += failed;
    runStats.productsSeen += products.length;
    info('ingest ok', { url, latencyMs: latency, sent: products.length, inserted, updated, failed });
  } else {
    runStats.rowsFailed += products.length;
    runStats.ingestErrors += 1;
    if (res.status === 429 && res.body && typeof res.body === 'object') {
      const resetAt = typeof res.body.reset_at === 'string' ? res.body.reset_at : null;
      rateLimitState = {
        at: nowIso(),
        resetAt,
        message: res.body.message || res.error || 'rate_limit_exceeded',
        tier: res.body.tier || null,
        limit: res.body.limit || null,
      };
      shuttingDown = true;
      warn('ingest rate limited; entering cooldown and stopping worker until reset', rateLimitState);
    }
    errorLog('ingest failed', { url, status: res.status, error: res.error, sample: typeof res.body === 'string' ? res.body.slice(0, 200) : res.body });
  }
}

async function writeHeartbeat(extra = {}) {
  const hb = {
    pid: process.pid,
    ts: nowIso(),
    tsMs: Date.now(),
    uptimeMs: Date.now() - startedAtMs,
    ...runStats,
    ...extra,
  };
  try {
    await fs.writeFile(HEARTBEATFILE, JSON.stringify(hb, null, 2));
  } catch (err) {
    warn('failed to write heartbeat', { error: String(err && err.message) });
  }
}

async function writeStatus() {
  const elapsedSec = Math.max(1, (Date.now() - startedAtMs) / 1000);
  const rows = runStats.rowsInserted + runStats.rowsUpdated;
  const rowsPerHour = Math.round((rows / elapsedSec) * 3600);
  const status = {
    lane: 'crew-wc-rest',
    issue: 'BUY-38482',
    source: INGEST_SOURCE,
    pid: process.pid,
    startedAt: new Date(startedAtMs).toISOString(),
    updatedAt: nowIso(),
    durationSec: args.durationSec,
    elapsedSec: Math.round(elapsedSec),
    rowsThisRun: rows,
    rowsPerHour,
    targetRowsPerHour: TARGET_ROWS_PER_HOUR,
    meetsTarget: rowsPerHour >= TARGET_ROWS_PER_HOUR,
    ingestApiUrl: INGEST_API_URL,
    dryRun: args.dryRun,
    cooldownActive: Boolean(
      rateLimitState
      && rateLimitState.resetAt
      && !Number.isNaN(Date.parse(rateLimitState.resetAt))
      && Date.parse(rateLimitState.resetAt) > Date.now()
    ),
    pauseUntil: rateLimitState && rateLimitState.resetAt ? rateLimitState.resetAt : null,
    pauseReason: rateLimitState ? 'ingest_rate_limit' : null,
    lastRateLimit: rateLimitState,
    ...runStats,
  };
  try {
    await fs.writeFile(STATUSFILE, JSON.stringify(status, null, 2));
  } catch (err) {
    warn('failed to write status', { error: String(err && err.message) });
  }
  return status;
}

async function fetchStoreProducts(merchant) {
  const out = [];
  const base = `https://${merchant.domain}/wp-json/wc/store/products`;
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (shuttingDown) break;
    const url = `${base}?per_page=${PER_PAGE}&page=${page}`;
    const res = await fetchJson(url);
    runStats.pagesFetched += 1;
    if (!res.ok) {
      // First-page failure usually means no Store API surface; later-page
      // failure is the normal end-of-catalog signal.
      if (page > 1) info('store pagination ended', { domain: merchant.domain, page, error: res.error, status: res.status });
      return { products: out, via: 'store', endedAtPage: page, lastError: res.error };
    }
    const items = Array.isArray(res.body) ? res.body : (res.body && Array.isArray(res.body.products) ? res.body.products : []);
    if (!items.length) return { products: out, via: 'store', endedAtPage: page };
    for (const it of items) out.push(clean(normalizeStoreProduct(it, merchant)));
    if (items.length < PER_PAGE) return { products: out, via: 'store', endedAtPage: page };
    await sleep(POLITENESS_MS);
  }
  return { products: out, via: 'store', endedAtPage: MAX_PAGES };
}

async function fetchV3Products(merchant) {
  const headers = wcAuthHeader(merchant);
  if (!headers) return { products: [], via: 'v3', skipped: 'no-auth' };
  const out = [];
  const base = `https://${merchant.domain}/wp-json/wc/v3/products`;
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (shuttingDown) break;
    const url = `${base}?per_page=${PER_PAGE}&page=${page}&status=publish`;
    const res = await fetchJson(url, { headers });
    runStats.pagesFetched += 1;
    if (!res.ok) {
      if (page > 1) info('v3 pagination ended', { domain: merchant.domain, page, error: res.error, status: res.status });
      return { products: out, via: 'v3', endedAtPage: page, lastError: res.error };
    }
    const items = Array.isArray(res.body) ? res.body : [];
    if (!items.length) return { products: out, via: 'v3', endedAtPage: page };
    for (const it of items) out.push(clean(normalizeV3Product(it, merchant)));
    if (items.length < PER_PAGE) return { products: out, via: 'v3', endedAtPage: page };
    await sleep(POLITENESS_MS);
  }
  return { products: out, via: 'v3', endedAtPage: MAX_PAGES };
}

async function visitMerchant(merchant) {
  runStats.merchantsVisited += 1;
  // Prefer the public Store API; fall back to v3 (auth) when available.
  let result = await fetchStoreProducts(merchant);
  let products = result.products;
  if ((!products.length) && (!shuttingDown)) {
    const v3 = await fetchV3Products(merchant);
    if (v3.products.length) products = v3.products;
  }
  if (products.length) {
    info('merchant harvested', { domain: merchant.domain, count: products.length, via: result.via });
  } else {
    info('merchant yielded no products', { domain: merchant.domain, lastError: result.lastError });
  }
  // Flush this merchant's products in ingest-sized batches.
  for (let i = 0; i < products.length; i += INGEST_BATCH) {
    if (shuttingDown) break;
    await ingestBatch(products.slice(i, i + INGEST_BATCH));
  }
  return products.length;
}

function deadlineReached() {
  if (args.maxRows && (runStats.rowsInserted + runStats.rowsUpdated) >= args.maxRows) return true;
  return (Date.now() - startedAtMs) / 1000 >= args.durationSec;
}

async function acquirePidfile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  // Idempotent guard: if a live worker for this lane is already running,
  // exit cleanly instead of double-starting. A stale pidfile (dead proc, or a
  // recycled PID belonging to an unrelated process) is reclaimed.
  if (existsSync(PIDFILE)) {
    try {
      const old = parseInt(String(await fs.readFile(PIDFILE, 'utf8')).trim(), 10);
      if (old && old !== process.pid) {
        let alive = false;
        try { process.kill(old, 0); alive = true; } catch {}
        if (alive) {
          let ours = false;
          try {
            const cl = await fs.readFile(`/proc/${old}/cmdline`, 'utf8');
            ours = cl.includes('buy31142-crew-wc-rest');
          } catch {
            // /proc unreadable (not Linux or gone) — assume stale, reclaim below.
          }
          if (ours) {
            info('another live worker is already running; exiting (idempotent)', { pid: old });
            process.exit(0);
          }
        }
      }
    } catch {
      // Unreadable pidfile — reclaim below.
    }
  }
  await fs.writeFile(PIDFILE, String(process.pid));
}

async function releasePidfile() {
  try {
    const cur = parseInt(String(await fs.readFile(PIDFILE, 'utf8')).trim(), 10);
    if (cur === process.pid) await fs.unlink(PIDFILE);
  } catch {
    // Already gone or not ours — nothing to do.
  }
}

let args;

async function run() {
  args = parseArgs(process.argv);
  const merchants = await loadMerchants();

  if (args.list) {
    console.log(JSON.stringify({ count: merchants.length, merchants }, null, 2));
    return;
  }
  if (!merchants.length) {
    errorLog(`no merchants loaded from ${MERCHANTS_PATH}`);
    process.exit(2);
  }

  await acquirePidfile();
  process.on('SIGTERM', () => { shuttingDown = true; });
  process.on('SIGINT', () => { shuttingDown = true; });

  info('worker starting', {
    pid: process.pid,
    durationSec: args.durationSec,
    maxRows: args.maxRows || 'unlimited',
    once: args.once,
    dryRun: args.dryRun,
    merchants: merchants.length,
    ingestApiUrl: INGEST_API_URL,
    apiKey: INGEST_API_KEY ? 'set' : 'MISSING',
  });
  await writeHeartbeat({ phase: 'start' });

  const logStatusEveryMs = 20000;
  let lastStatusAt = 0;

  try {
    while (!shuttingDown && !deadlineReached()) {
      runStats.sweeps += 1;
      for (const merchant of merchants) {
        if (shuttingDown || deadlineReached()) break;
        await visitMerchant(merchant);
        await writeHeartbeat({ phase: 'visit', domain: merchant.domain, sweep: runStats.sweeps });
        if (Date.now() - lastStatusAt > logStatusEveryMs) {
          await writeStatus();
          lastStatusAt = Date.now();
        }
      }
      if (args.once) break;
    }
  } finally {
    const status = await writeStatus();
    await writeHeartbeat({ phase: 'exit' });
    await releasePidfile();
    const rows = runStats.rowsInserted + runStats.rowsUpdated;
    info('worker finished', {
      reason: shuttingDown ? 'signal' : (args.once ? 'once' : 'duration'),
      durationSec: Math.round((Date.now() - startedAtMs) / 1000),
      sweeps: runStats.sweeps,
      merchantsVisited: runStats.merchantsVisited,
      pagesFetched: runStats.pagesFetched,
      rowsInserted: runStats.rowsInserted,
      rowsUpdated: runStats.rowsUpdated,
      rowsFailed: runStats.rowsFailed,
      rowsPerHour: status.rowsPerHour,
      meetsTarget: status.meetsTarget,
    });
  }
}

run().catch(async (err) => {
  errorLog('worker crashed', { error: String(err && err.message || err), stack: err && err.stack });
  try { await writeHeartbeat({ phase: 'crash', error: String(err && err.message) }); } catch {}
  try { await releasePidfile(); } catch {}
  process.exit(1);
});
