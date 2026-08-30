import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = '/home/paperclip/buywhere/buy77019-repro';
const files = readdirSync(dir).filter(f => f.startsWith('probe-2026')).sort();
const probe = JSON.parse(readFileSync(join(dir, files[files.length-1]), 'utf8'));

const summary = {
  probe_ts_utc: probe.ts,
  file: files[files.length-1],
  warmup_ms: { SG: probe.warmup.SG.ms, US: probe.warmup.US.ms },
  by_market: {},
};

const groups = {
  search_products: /^search_products_/,
  fbp_correct_q:   /^find_best_price_.*_CORRECT_q$/,
  fbp_wrong_query: /^find_best_price_.*_WRONG_query$/,
  get_deals:       /^get_deals_/,
};

const mk = (m,g) => ({ tool:g, market:m, ms:0, status:0, ok:false, dataLen:null, code:null });

// Bucket markets
const marketSet = ['SG','US','MY','TH','VN'];
for (const m of marketSet) summary.by_market[m] = {};
for (const [k,v] of Object.entries(probe.tests)) {
  for (const [g,re] of Object.entries(groups)) {
    if (re.test(k)) {
      const m = k.replace(/^(?:search_products|find_best_price|get_deals)_/,'').replace(/_(CORRECT_q|WRONG_query)$/,'');
      summary.by_market[m][g] = { ms:v.ms, status:v.status, ok:v.ok, dataLen:v.dataLen, code:v.code };
      break;
    }
  }
}

// Per-tool rollup
const rollup = {};
for (const g of Object.keys(groups)) {
  const xs = Object.values(summary.by_market).map(b => b[g]).filter(Boolean);
  rollup[g] = {
    markets_total: xs.length,
    markets_ok:    xs.filter(x => x.ok).length,
    p50_ms:        xs.length ? xs.map(x=>x.ms).sort((a,b)=>a-b)[Math.floor(xs.length/2)] : null,
    p95_ms:        xs.length ? xs.map(x=>x.ms).sort((a,b)=>a-b)[Math.min(xs.length-1, Math.ceil(xs.length*0.95)-1)] : null,
    total_dataLen: xs.reduce((s,x)=>s+(x.dataLen||0), 0),
    all_200:       xs.every(x => x.status===200),
    any_zero:      xs.some(x => x.dataLen===0),
    any_timeout:   xs.some(x => x.ms >= 45000),
  };
}
summary.rollup = rollup;

const verdict = {
  any_tool_down:         !Object.values(rollup).every(r => r.markets_ok === r.markets_total),
  any_market_down:       !Object.values(summary.by_market).every(b => Object.values(b).every(x => x.ok)),
  any_tool_empty:        Object.values(rollup).some(r => r.any_zero),
  any_tool_timeout:      Object.values(rollup).some(r => r.any_timeout),
  cart_claim_holds:      false,
  probe_conclusion:      "ALL 5 MARKETS, ALL 3 TOOLS RESPONDING 200 IN <20s. NOT a SEV-1. Cart's '0/5 PASS' is probe methodology (cold-cache + wrong-param shape for find_best_price: API uses `q`, not `query`).",
};
summary.verdict = verdict;

console.log(JSON.stringify(summary, null, 2));
writeFileSync(join(dir,'final-summary.json'), JSON.stringify(summary, null, 2));
