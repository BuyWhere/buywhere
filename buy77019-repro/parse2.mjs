import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const dir = '/home/paperclip/buywhere/buy77019-repro';
const files = readdirSync(dir).filter(f => f.startsWith('probe-2026')).sort();
const probe = JSON.parse(readFileSync(join(dir, files[files.length-1]), 'utf8'));
function get(t){ return probe.tests[t]; }

for (const k of ['search_products_SG','find_best_price_SG_CORRECT_q','find_best_price_SG_WRONG_query','get_deals_SG','get_deals_MY']) {
  const r = get(k);
  const txt = r.body?.result?.content?.[0]?.text;
  let inner; try { inner = JSON.parse(txt); } catch { inner = txt; }
  let data = inner?.data ?? inner;
  console.log('===', k, '===');
  console.log('keys at root:', Object.keys(inner||{}));
  console.log('keys at data:', data && typeof data==='object' ? Object.keys(data) : null);
  if (typeof inner?.data === 'object' && inner.data !== null && !Array.isArray(inner.data)) {
    const d2 = inner.data;
    console.log(' data.total:', d2.total, 'data.unavailable:', d2.unavailable, 'data.error:', d2.error?.slice?.(0,140));
    for (const arr of ['products','deals','offers','results','items','data']) {
      if (Array.isArray(d2[arr])) console.log(`  data.${arr}.length:`, d2[arr].length);
    }
  }
  if (Array.isArray(inner?.data)) {
    console.log(' data is array, length:', inner.data.length);
  }
}
