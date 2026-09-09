// Parse the big probe JSON into a compact summary
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = '/home/paperclip/buywhere/buy77019-repro';
const files = readdirSync(dir).filter(f => f.startsWith('probe-2026')).sort();
const latest = files[files.length-1];
console.log('latest probe file:', latest);

const probe = JSON.parse(readFileSync(join(dir, latest), 'utf8'));

function unwrap(r) {
  const out = { ms:r.ms, status:r.status, ok:r.ok };
  if (!r.ok) return { ...out, err:String(r.body?.err||JSON.stringify(r.body)).slice(0,140) };
  const txt = r.body?.result?.content?.[0]?.text;
  if (!txt) return { ...out, raw:r.body };
  let inner; try { inner = JSON.parse(txt); } catch { return { ...out, raw:txt.slice(0,140)}; }
  const data = inner?.data ?? inner;
  out.code = r.body?.result?.isError ? 'isError' : 200;
  out.total = data?.total ?? inner?.total;
  out.unavailable = data?.unavailable;
  if (Array.isArray(data?.data)) out.dataLen = data.data.length;
  else if (Array.isArray(data?.products)) out.dataLen = data.products.length;
  else if (Array.isArray(data?.deals)) out.dataLen = data.deals.length;
  else if (Array.isArray(data?.offers)) out.dataLen = data.offers.length;
  else if (Array.isArray(data)) out.dataLen = data.length;
  else out.dataLen = null;
  out.dataKeys = data && typeof data === 'object' ? Object.keys(data).slice(0,8) : null;
  out.error = data?.error?.slice?.(0,140);
  return out;
}

const summary = {
  ts: probe.ts,
  warmup: {
    SG: unwrap(probe.warmup.SG),
    US: unwrap(probe.warmup.US),
  },
  tests: {},
};
for (const [k,v] of Object.entries(probe.tests)) {
  summary.tests[k] = unwrap(v);
}
console.log(JSON.stringify(summary, null, 2));
