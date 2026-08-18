#!/usr/bin/env node
// Probe /v1/products/search freshness (BUY-71417).
// Samples `limit` results for each query, reports % with updated_at > 30 days old.

const API_BASE = process.env.API_BASE || 'https://api.buywhere.ai';
const API_KEY = process.env.BUYWHERE_API_KEY || '';
const QUERIES = (process.env.QUERIES || 'laptop,iphone,headphones,shoes,dress,watch,camera,tv,fridge,vacuum').split(',');
const LIMIT = Number(process.env.LIMIT || 50);
const COUNTRY = process.env.COUNTRY || 'SG';
const STALE_DAYS = Number(process.env.STALE_DAYS || 30);

const headers = { Accept: 'application/json' };
if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;

const now = Date.now();
const staleThresholdMs = STALE_DAYS * 24 * 60 * 60 * 1000;

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchSearch(q) {
  const url = new URL(`${API_BASE}/v1/products/search`);
  url.searchParams.set('q', q);
  url.searchParams.set('country_code', COUNTRY);
  url.searchParams.set('limit', String(LIMIT));
  const res = await fetch(url, { headers });
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after') || '2');
    console.error(`429 for "${q}"; sleeping ${retryAfter}s...`);
    await sleep(retryAfter * 1000);
    return fetchSearch(q);
  }
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  return res.json();
}

function isStale(updatedAt) {
  if (!updatedAt) return true;
  const t = new Date(updatedAt).getTime();
  return Number.isFinite(t) && (now - t) > staleThresholdMs;
}

async function main() {
  let total = 0;
  let stale = 0;
  const rows = [];
  for (const q of QUERIES) {
    await sleep(Number(process.env.DELAY_MS || 1200));
    const data = await fetchSearch(q);
    const results = data.results || data.data || [];
    const qStale = results.filter((r) => isStale(r.updated_at)).length;
    total += results.length;
    stale += qStale;
    rows.push({
      query: q,
      returned: results.length,
      stale: qStale,
      pct: results.length ? ((qStale / results.length) * 100).toFixed(1) : 'N/A',
      oldest: results.length ? results.map((r) => r.updated_at).filter(Boolean).sort()[0] : null,
      newest: results.length ? results.map((r) => r.updated_at).filter(Boolean).sort().reverse()[0] : null,
    });
  }
  const overallPct = total ? ((stale / total) * 100).toFixed(1) : 'N/A';
  console.log(JSON.stringify({
    api_base: API_BASE,
    country: COUNTRY,
    stale_days: STALE_DAYS,
    total,
    stale,
    stale_pct: Number(overallPct),
    per_query: rows,
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
