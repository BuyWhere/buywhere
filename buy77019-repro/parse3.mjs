import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const dir = '/home/paperclip/buywhere/buy77019-repro';
const files = readdirSync(dir).filter(f => f.startsWith('probe-2026')).sort();
const probe = JSON.parse(readFileSync(join(dir, files[files.length-1]), 'utf8'));
function get(t){ return probe.tests[t]; }

for (const k of ['search_products_SG','find_best_price_SG_CORRECT_q','find_best_price_SG_WRONG_query','get_deals_SG','get_deals_MY','get_deals_VN']) {
  const r = get(k);
  console.log('===', k, '===');
  console.log('top-level keys:', Object.keys(r.body));
  const c0 = r.body?.result?.content?.[0];
  console.log('content[0] keys:', c0 ? Object.keys(c0) : null);
  const txt = c0?.text;
  console.log('text first 250:', txt?.slice(0,250));
  console.log('text last 250:', txt?.slice(-250));
  console.log('text length:', txt?.length);
  console.log('---');
}
