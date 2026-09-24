#!/usr/bin/env node
// @title BUY-31015 WooCommerce deep-page lane worker (real).
//
// Deep-pages known WooCommerce (WC) merchants from
//   data/buy31015-wc-known-merchants.json
// hitting, per domain:
//   1. /wp-json/wc/store/products  (public Store API — no auth)
//   2. /wp-json/wc/v3/products      (WC v3 REST — basic auth if creds present)
// Normalizes each product and upserts into maglev.products via
//   POST {INGEST_API_URL}/v1/ingest  with source = "woocommerce_deep".
//
// Writes supervisor-compatible status/heartbeat for the deep-page supervisor
// and keep-alive scripts (data/buy31015-deep-page-status.json, .heartbeat).
//
// Lifecycle:
//   - Runs for --duration-sec seconds (default 240), then exits.
//   - Writes status + heartbeat on each page so the supervisor can report.
//   - Cycles repeatedly over the known merchant list within the window.

import fs from 'node:fs';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, openSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const DATA_DIR = process.env.WC_LANE_STATE_DIR || path.join(ROOT, 'data');

const MERCHANTS_PATH = process.env.WC_KNOWN_MERCHANTS_PATH
  || path.join(DATA_DIR, 'buy31015-wc-known-merchants.json');

const STATUS_FILE = path.join(DATA_DIR, 'buy31015-deep-page-status.json');
const HEARTBEAT_FILE = path.join(DATA_DIR, 'buy31015-deep-page.heartbeat');
const LOG_FILE = path.join(ROOT, 'logs', 'buy31015_woocommerce_deep.log');

const INGEST_SOURCE = 'woocommerce_deep';
const INGEST_API_URL = (process.env.INGEST_API_URL
  || process.env.BUYWHERE_API_URL
  || 'http://localhost:8000').replace(/\/$/, '');
const INGEST_API_KEY = process.env.BUYWHERE_API_KEY || '';

const PER_PAGE = 100;
const MAX_PAGES = 20;
const INGEST_BATCH = 500;
const REQUEST_TIMEOUT_MS = 15000;
const POLITENESS_MS = 100;

const startedAtMs = Date.now();
let shuttingDown = false;
let cycleNum = 0;
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
function nowIso() { return new Date().toISOString(); }

function log(level, message, extra) {
  const line = `[wc-deep ${nowIso()}] [${level}] ${message}`;
  const full = extra ? `${line} ${JSON.stringify(extra)}` : line;
  console[level === 'error' ? 'error' : 'log'](full);
  // appendFileSync omitted — supervisor captures stdout/stderr to LOG_FILE
}
const info = (m, e) => log('info', m, e);
const warn = (m, e) => log('warn', m, e);
const errorLog = (m, e) => log('error', m, e);

function parseArgs(argv) {
  const out = { durationSec: 240, maxRows: 0, once: false, dryRun: false, list: false, cycle: 0 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--duration-sec') out.durationSec = parseInt(argv[++i], 10) || out.durationSec;
    else if (a.startsWith('--duration-sec=')) out.durationSec = parseInt(a.split('=')[1], 10) || out.durationSec;
    else if (a === '--max-rows') out.maxRows = parseInt(argv[++i], 10) || 0;
    else if (a.startsWith('--max-rows=')) out.maxRows = parseInt(a.split('=')[1], 10) || 0;
    else if (a === '--once') out.once = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--list') out.list = true;
    else if (a.startsWith('--cycle=')) out.cycle = parseInt(a.split('=')[1], 10) || 0;
    else if (a === '-h' || a === '--help') {
      console.log(`Usage: buy31015-woocommerce-deep-page.mjs [--duration-sec=240] [--max-rows=N] [--once] [--dry-run] [--list] [--cycle=N]`);
      process.exit(0);
    }
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadMerchants() {
  if (!existsSync(MERCHANTS_PATH)) {
    console.error(`[wc-deep] WARNING: merchants file not found at ${MERCHANTS_PATH} — returning empty list`);
    return [];
  }
  const raw = readFileSync(MERCHANTS_PATH, 'utf8');
  const data = JSON.parse(raw);
  const list = Array.isArray(data) ? data : (data.merchants || []);
  return list
    .filter((m) => m && typeof m.domain === 'string')
    .map((m) => ({
      domain: m.domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase(),
      platform: m.platform || 'woocommerce',
      country: m.country || 'US',
      currency: m.currency || 'USD',
      category: m.category || '',
      consumerKey: m.consumer_key || '',
      consumerSecret: m.consumer_secret || '',
    }));
}
function normalizeStoreProduct(p, merchant) {
  const name = String(p.name || p.title || '').trim();
  if (!name) return null;
  const sku = p.sku || p.id?.toString() || '';
  const price = p.prices?.price || p.price || '';
  const currency = p.prices?.currency_code || merchant.currency || 'USD';
  const description = (p.description || '').replace(/<[^>]*>/g, '').trim();
  const image = (p.images && p.images[0]?.src) || p.images?.[0] || '';
  const categories = (p.categories || []).map((c) => (typeof c === 'string' ? c : c.name)).filter(Boolean);
  return {
    title: name,
    merchant_id: merchant.domain,
    sku,
    upc: p.upc || '',
    ean: p.ean || '',
    brand: p.brand || '',
    price: parseFloat(price) || 0,
    currency,
    description: description.slice(0, 500),
    image_url: image,
    category: categories.join(' > '),
    category_hierarchy: categories,
    stock: p.is_in_stock ?? true,
    in_stock: p.stock_status ? p.stock_status === 'instock' : undefined,
    availability: p.stock_status || undefined,
    is_active: true,
    url: `https://${merchant.domain}${p.permalink || `/product/${p.slug || p.id}`}`,
    country_code: merchant.country,
    source: INGEST_SOURCE,
  };
}

function normalizeV3Product(p, merchant) {
  const name = String(p.name || p.title || '').trim();
  if (!name) return null;
  const sku = p.sku || String(p.id) || '';
  const price = p.price || p.regular_price || '';
  const currency = merchant.currency || 'USD';
  const description = (p.description || p.short_description || '').replace(/<[^>]*>/g, '').trim();
  const image = (p.images && p.images[0]?.src) || '';
  const categories = (p.categories || []).map((c) => (typeof c === 'string' ? c : c.name)).filter(Boolean);
  return {
    title: name,
    merchant_id: merchant.domain,
    sku,
    upc: p.upc || '',
    ean: p.ean || '',
    brand: p.brand || '',
    price: parseFloat(price) || 0,
    currency,
    description: description.slice(0, 500),
    image_url: image,
    category: categories.join(' > '),
    category_hierarchy: categories,
    stock: p.stock_status === 'instock' || p.stock_status === 'onbackorder',
    in_stock: p.stock_status ? p.stock_status === 'instock' : undefined,
    availability: p.stock_status || undefined,
    is_active: p.status ? p.status === 'publish' : true,
    url: `https://${merchant.domain}${p.permalink || `/?product=${p.id}`}`,
    country_code: merchant.country,
    source: INGEST_SOURCE,
  };
}
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    const body = await res.json().catch(() => null);
    const ctype = (res.headers.get('content-type') || '').toLowerCase();
    if (body && typeof body === 'object') {
      return { ok: true, status: res.status, body };
    }
    const text = body == null ? await res.text().catch(() => '') : JSON.stringify(body);
    if (text && !text.startsWith('<')) {
      try { return { ok: true, status: res.status, body: JSON.parse(text) }; } catch {}
    }
    if (res.status === 200 && !ctype.includes('json')) {
      return { ok: false, status: res.status, error: `non-json content-type (${ctype})`, sample: text.slice(0, 120) };
    }
    return { ok: false, status: res.status, error: `http ${res.status}`, body: text ? text.slice(0, 200) : undefined };
  } catch (err) {
    clearTimeout(timer);
    const msg = err.name === 'AbortError' ? 'timeout' : (err.message || String(err));
    return { ok: false, status: 0, error: msg };
  }
}

async function fetchStoreProducts(merchant) {
  const base = `https://${merchant.domain}/wp-json/wc/store/products`;
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (shuttingDown) break;
    const url = `${base}?per_page=${PER_PAGE}&page=${page}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      if (page > 1) info('store pagination ended', { domain: merchant.domain, page, error: res.error, status: res.status });
      break;
    }
    const items = Array.isArray(res.body) ? res.body : (res.body.products || []);
    if (!items.length) break;
    for (const p of items) {
      const n = normalizeStoreProduct(p, merchant);
      if (n) out.push(n);
    }
    runStats.pagesFetched += 1;
    if (items.length < PER_PAGE) break;
    await sleep(POLITENESS_MS);
  }
  return out;
}
async function fetchV3Products(merchant) {
  const base = `https://${merchant.domain}/wp-json/wc/v3/products`;
  const auth = (merchant.consumerKey && merchant.consumerSecret)
    ? { Authorization: `Basic ${Buffer.from(`${merchant.consumerKey}:${merchant.consumerSecret}`).toString('base64')}` }
    : {};
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (shuttingDown) break;
    const url = `${base}?per_page=${PER_PAGE}&page=${page}&status=publish`;
    const res = await fetchWithTimeout(url, { headers: { ...auth, Accept: 'application/json' } });
    if (!res.ok) {
      if (page > 1) info('v3 pagination ended', { domain: merchant.domain, page, error: res.error, status: res.status });
      break;
    }
    const items = Array.isArray(res.body) ? res.body : (res.body.products || []);
    if (!items.length) break;
    for (const p of items) {
      const n = normalizeV3Product(p, merchant);
      if (n) out.push(n);
    }
    runStats.pagesFetched += 1;
    if (items.length < PER_PAGE) break;
    await sleep(POLITENESS_MS);
  }
  return out;
}

async function ingestBatch(products, opts = {}) {
  if (opts.dryRun) {
    runStats.rowsInserted += products.length;
    return;
  }
  const url = `${INGEST_API_URL}/v1/ingest`;
  const payload = { source: INGEST_SOURCE, products };
  let retries = 2;
  while (retries >= 0) {
    if (shuttingDown) return;
    try {
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(INGEST_API_KEY ? { Authorization: `Bearer ${INGEST_API_KEY}` } : {}),
        },
        body: JSON.stringify(payload),
        timeout: 30000,
      });
      runStats.batches += 1;
      if (res.ok && res.body) {
        const r = res.body;
        runStats.rowsInserted += (r.rows_inserted || 0);
        runStats.rowsUpdated += (r.rows_updated || 0);
        runStats.rowsFailed += (r.rows_failed || 0);
        return;
      }
      if (res.status === 429) {
        const wait = Math.min(10000 * (3 - retries), 15000);
        warn('ingest rate limited', { status: res.status, wait, retries });
        await sleep(wait);
        retries -= 1;
        continue;
      }
      errorLog('ingest failed', { url, status: res.status, error: res.error, retries });
      runStats.ingestErrors += 1;
      runStats.rowsFailed += products.length;
      return;
    } catch (err) {
      errorLog('ingest threw', { error: err.message, retries });
      runStats.ingestErrors += 1;
      if (retries <= 0) { runStats.rowsFailed += products.length; return; }
      retries -= 1;
      await sleep(2000);
    }
  }
}
function writeJsonAtomic(filePath, obj) {
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`);
  renameSync(tmp, filePath);
}

async function writeHeartbeat(phase, extra = {}) {
  try {
    const hb = { ts: nowIso(), phase, pid: process.pid, cycle: cycleNum, ...extra };
    writeJsonAtomic(HEARTBEAT_FILE, hb);
  } catch (err) {
    warn('failed to write heartbeat', { error: String(err?.message) });
  }
}

async function writeStatus() {
  const elapsedMs = Math.max(1, Date.now() - startedAtMs);
  const rowsPerHour = Math.round(((runStats.rowsInserted + runStats.rowsUpdated) / elapsedMs) * 3600000);
  const status = {
    ts: nowIso(),
    lane: 'buy31015_woocommerce_deep',
    cycle: cycleNum,
    merchantsVisited: runStats.merchantsVisited,
    rowsInserted: runStats.rowsInserted,
    rowsUpdated: runStats.rowsUpdated,
    rowsPerHour,
    discoveredMerchants: runStats.merchantsVisited,
    totalMerchants: runStats.merchantsVisited,
    phase: 'tick',
    reason: 'worker_heartbeat',
    processId: process.pid,
  };
  try {
    writeJsonAtomic(STATUS_FILE, status);
  } catch (err) {
    warn('failed to write status', { error: String(err?.message) });
  }
  return status;
}

async function visitMerchant(merchant, dryRun) {
  runStats.merchantsVisited += 1;
  let result = await fetchStoreProducts(merchant);
  let products = result;
  let via = 'store';
  if ((!products.length) && (!shuttingDown)) {
    const v3 = await fetchV3Products(merchant);
    if (v3.length) { products = v3; via = 'v3'; }
  }
  if (products.length) {
    info('merchant harvested', { domain: merchant.domain, count: products.length, via });
    runStats.productsSeen += products.length;
  } else {
    info('merchant yielded no products', { domain: merchant.domain });
  }
  for (let i = 0; i < products.length; i += INGEST_BATCH) {
    if (shuttingDown) break;
    await ingestBatch(products.slice(i, i + INGEST_BATCH), { dryRun });
  }
  return products.length;
}
function readBaseline() {
  if (!existsSync(STATUS_FILE)) return { cycle: 0 };
  try {
    const raw = readFileSync(STATUS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return { cycle: Number(parsed.cycle) || 0 };
  } catch { return { cycle: 0 }; }
}

function deadlineReached(args) {
  if (args.maxRows && (runStats.rowsInserted + runStats.rowsUpdated) >= args.maxRows) return true;
  return (Date.now() - startedAtMs) / 1000 >= args.durationSec;
}

async function run() {
  const args = parseArgs(process.argv);
  cycleNum = args.cycle > 0 ? args.cycle : (readBaseline().cycle + 1);
  const merchants = await loadMerchants();

  if (args.list) {
    console.log(JSON.stringify({ count: merchants.length, merchants }, null, 2));
    return;
  }
  if (!merchants.length) {
    errorLog(`no merchants loaded from ${MERCHANTS_PATH}`);
    process.exit(2);
  }

  mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  mkdirSync(DATA_DIR, { recursive: true });

  process.on('SIGTERM', () => { shuttingDown = true; });
  process.on('SIGINT', () => { shuttingDown = true; });

  info('worker starting', {
    pid: process.pid,
    durationSec: args.durationSec,
    maxRows: args.maxRows || 'unlimited',
    once: args.once,
    dryRun: args.dryRun,
    cycle: cycleNum,
    merchants: merchants.length,
    ingestApiUrl: INGEST_API_URL,
    apiKey: INGEST_API_KEY ? 'set' : 'MISSING',
  });
  await writeHeartbeat('start', { cycle: cycleNum, merchantsVisited: 0 });

  const logStatusEveryMs = 20000;
  let lastStatusAt = 0;

  try {
    while (!shuttingDown && !deadlineReached(args)) {
      runStats.sweeps += 1;
      for (const merchant of merchants) {
        if (shuttingDown || deadlineReached(args)) break;
        await visitMerchant(merchant, args.dryRun);
        if (Date.now() - lastStatusAt > logStatusEveryMs) {
          await writeStatus();
          await writeHeartbeat('tick', { cycle: cycleNum, merchantsVisited: runStats.merchantsVisited });
          lastStatusAt = Date.now();
        }
      }
      if (args.once) break;
    }
  } catch (err) {
    errorLog('worker error', { error: String(err?.message || err) });
  } finally {
    const status = await writeStatus();
    await writeHeartbeat('exit', {
      cycle: cycleNum,
      merchantsVisited: runStats.merchantsVisited,
      rowsInserted: runStats.rowsInserted,
      rowsUpdated: runStats.rowsUpdated,
    });
    const rows = runStats.rowsInserted + runStats.rowsUpdated;
    info('worker finished', {
      reason: shuttingDown ? 'signal' : (args.once ? 'once' : 'duration'),
      durationSec: Math.round((Date.now() - startedAtMs) / 1000),
      cycle: cycleNum,
      sweeps: runStats.sweeps,
      merchantsVisited: runStats.merchantsVisited,
      pagesFetched: runStats.pagesFetched,
      productsSeen: runStats.productsSeen,
      rowsInserted: runStats.rowsInserted,
      rowsUpdated: runStats.rowsUpdated,
      rowsFailed: runStats.rowsFailed,
      rowsPerHour: status.rowsPerHour,
    });
  }
}

run().catch((err) => {
  errorLog('worker crashed', { error: String(err?.message || err), stack: err?.stack });
  process.exit(1);
});
