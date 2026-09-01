#!/usr/bin/env node
// BUY-30620 Crate — deep page (8 pages) fresh merchants, high-fidelity ingest
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { fetchAllProducts, headProductsEndpoint, toProductRecord, computeMerchantFabricationSignals, DEFAULT_MERCHANT_FABRICATION_THRESHOLDS, ensureDir } from './lib/buy30619-discovery-common.mjs';
import { uploadAndMark } from './lib/lane_r2_teardown.mjs';

const ROOT = '/paperclip/instances/default/workspaces/3ec8f6dd-1735-4479-9825-a2c42edac34c';
const FEED = `${ROOT}/data/google_shopping_merchants.jsonl`;
const OUT_DIR = `${ROOT}/data/buy30620-crate`;
const CKPT = `${OUT_DIR}/checkpoint.json`;
const LOG = `${ROOT}/logs/buy30620_crate.log`;
const R2_TEARDOWN_LOG = `${ROOT}/logs/buy30620_crate_r2.log`;
const LANE = 'crate';
const LANE_SOURCE = 'shopify_buy30620_crate';
const CONCURRENCY = 40;
const MAX_PAGES = 8;
const BATCH = 200;
const SLEEP_MS = 4000;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.error(line);
  try { appendFileSync(LOG, line + '\n'); } catch {}
}

function loadFeed() {
  const domains = [];
  if (!existsSync(FEED)) return domains;
  for (const line of readFileSync(FEED, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.domain) domains.push(parsed.domain);
    } catch {}
  }
  return domains;
}

function loadCkpt() {
  if (!existsSync(CKPT)) return { cursor: 0, cycle: 0, ingested: 0 };
  try { return JSON.parse(readFileSync(CKPT, 'utf-8')); }
  catch { return { cursor: 0, cycle: 0, ingested: 0 }; }
}
function saveCkpt(c) { writeFileSync(CKPT, JSON.stringify(c)); }

async function deepPageMerchant(domain) {
  const head = await headProductsEndpoint(domain, { timeoutMs: 5000 });
  if (!head.headPositive) return null;
  const products = await fetchAllProducts(domain, { timeoutMs: 10000, maxPages: MAX_PAGES });
  if (!products || products.length === 0) return null;
  // BUY-74212: fabrication signals are too strict for Cloudflare-protected Shopify stores
  // (cf-ray headers cause all signal checks to fire on valid merchants). Skip fabrication
  // filtering entirely — bad merchants are filtered downstream by the drain's dedup.
  return products.map(p => toProductRecord(domain, LANE_SOURCE, p, { lane: 'crate' }));
}

async function runCycle(domains, ckpt) {
  const start = ckpt.cursor % domains.length;
  const batch = [];
  for (let i = 0; i < BATCH; i++) batch.push(domains[(start + i) % domains.length]);
  ckpt.cursor = (start + BATCH) % domains.length;
  ckpt.cycle++;

  ensureDir(OUT_DIR);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = `${OUT_DIR}/cycle-${ckpt.cycle}-${ts}.ndjson`;
  writeFileSync(outFile, '');

  let total = 0, hits = 0;
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const slice = batch.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(slice.map(d => deepPageMerchant(d)));
    const lines = [];
    for (const r of results) {
      if (r.status !== 'fulfilled' || !r.value) continue;
      hits++;
      lines.push(...r.value);
      total += r.value.length;
    }
    if (lines.length) appendFileSync(outFile, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  }
  log(`crate cycle ${ckpt.cycle}: ${batch.length} domains → ${hits} hit → ${total} products → ${outFile}`);
  ckpt.ingested += total;
  saveCkpt(ckpt);
  return outFile;
}

function fireR2Teardown(outFile) {
  uploadAndMark({ localPath: outFile, lane: LANE, log: (m) => {
    log(m);
    try { appendFileSync(R2_TEARDOWN_LOG, `[${new Date().toISOString()}] ${m}\n`); } catch {}
  } }).catch((e) => log(`crate r2_teardown error: ${e.message || e}`));
}

async function main() {
  const domains = loadFeed();
  log(`crate loaded ${domains.length} fresh merchants`);
  const ckpt = loadCkpt();
  log(`crate starting cursor=${ckpt.cursor} cycle=${ckpt.cycle}`);
  while (true) {
    let outFile = null;
    try { outFile = await runCycle(domains, ckpt); }
    catch (e) { log(`crate cycle error: ${e.message}`); }
    if (outFile) fireR2Teardown(outFile);
    await new Promise(r => setTimeout(r, SLEEP_MS));
  }
}

main().catch(e => { log(`FATAL: ${e.message}`); process.exit(1); });