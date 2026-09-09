// BUY-77019 repro — JSON-RPC against api.buywhere.ai/mcp
import { readFileSync } from 'node:fs';

const secrets = JSON.parse(readFileSync('/home/paperclip/.secrets/fleet-secrets.json', 'utf8'));
const API_KEY = secrets.BUYWHERE_API_KEY;
const ENDPOINT = 'https://api.buywhere.ai/mcp';
const MARKETS = ['SG','US','MY','TH','VN'];
const TIMEOUT_MS = 45000; // ≥45s as per memory guidance

let _id = 1;
async function rpc(tool, args) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const r = await fetch(ENDPOINT, {
      method:'POST',
      headers:{'Content-Type':'application/json','Accept':'application/json, text/event-stream','Authorization':`Bearer ${API_KEY}`},
      body:JSON.stringify({jsonrpc:'2.0', id:_id++, method:'tools/call', params:{name:tool, arguments:args}}),
      signal:ctl.signal,
    });
    const ms = Date.now()-t0;
    const txt = await r.text();
    let body;
    try { body = JSON.parse(txt); } catch { body = {raw:txt.slice(0,300)}; }
    return { ok:r.ok, status:r.status, ms, body };
  } catch(e) {
    return { ok:false, status:'ERR', ms:Date.now()-t0, body:{err:String(e).slice(0,200)} };
  } finally { clearTimeout(t); }
}

// Parse MCP result.content[0].text JSON if present
function unwrap(r) {
  if (!r.ok) return {code:r.status, error:r.body};
  const content = r.body?.result?.content?.[0]?.text;
  if (!content) return {code:200, raw:r.body};
  try {
    const inner = JSON.parse(content);
    return {
      code:200,
      isError: r.body?.result?.isError,
      dataKeys: inner && typeof inner === 'object' ? Object.keys(inner) : null,
      total: inner?.total ?? inner?.data?.total,
      unavailable: inner?.data?.unavailable,
      dataLen: Array.isArray(inner?.data) ? inner.data.length : (Array.isArray(inner?.data?.products) ? inner.data.products.length : (Array.isArray(inner?.data?.deals) ? inner.data.deals.length : (Array.isArray(inner?.data?.offers) ? inner.data.offers.length : null))),
    };
  } catch { return {code:200, raw:content.slice(0,300)}; }
}

const out = { ts:new Date().toISOString(), warmup:{}, tests:{} };

// warm cache
out.warmup.SG = await rpc('search_products', {market:'SG', query:'sneakers', limit:1});
out.warmup.US = await rpc('search_products', {market:'US', query:'sneakers', limit:1});
await new Promise(r=>setTimeout(r,300));

for (const m of MARKETS) {
  const r = await rpc('search_products', {market:m, query:'sneakers', limit:5});
  out.tests[`search_products_${m}`] = {ms:r.ms, status:r.status, ok:r.ok, ...unwrap(r)};
}
for (const m of MARKETS) {
  const r = await rpc('find_best_price', {market:m, q:'sneakers', limit:5});
  out.tests[`find_best_price_${m}_CORRECT_q`] = {ms:r.ms, status:r.status, ok:r.ok, ...unwrap(r)};
}
for (const m of MARKETS) {
  const r = await rpc('find_best_price', {market:m, query:'sneakers', limit:5});
  out.tests[`find_best_price_${m}_WRONG_query`] = {ms:r.ms, status:r.status, ok:r.ok, ...unwrap(r)};
}
for (const m of MARKETS) {
  const r = await rpc('get_deals', {market:m, query:'sneakers', limit:5});
  out.tests[`get_deals_${m}`] = {ms:r.ms, status:r.status, ok:r.ok, ...unwrap(r)};
}

console.log(JSON.stringify(out, null, 2));
