// BUY-32028: regression guard for ts_rank ORDER BY in any search CTE path.
// History: e8f407dc (BUY-31540) removed ts_rank ORDER BY from the live /v1/products/search
// handler, similar-products query, mcp.ts, landing.ts, and the Python search routers.
// However, the warmSearchCache CTE in api/src/routes/products.ts was missed. On broad
// US queries (laptop+US = 70k+ matches), the CTE materialized all rows before LIMIT and
// stalled the cache warm-up, leaving the live endpoint cold and triggering the same 20s
// timeout at the API layer. This test walks every .ts file under api/src and fails if
// any of them ships a ts_rank(...) in a search ORDER BY. Run in CI and as a pre-deploy
// gate; a 30-line test that costs nothing and prevents a P0 outage.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const apiSrcRoot = path.resolve(__dirname, '..', 'src');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && /\.(ts|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('BUY-32028: ts_rank ORDER BY regression guard', () => {
  it('api/src must not contain ts_rank in any ORDER BY clause', () => {
    const offenders = [];
    for (const file of walk(apiSrcRoot)) {
      const rel = path.relative(apiSrcRoot, file);
      const source = fs.readFileSync(file, 'utf8');
      const lines = source.split('\n');
      lines.forEach((line, i) => {
        if (/\bts_rank\s*\(/.test(line) && /ORDER\s+BY/i.test(line)) {
          offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    assert.deepEqual(
      offenders,
      [],
      `ts_rank() found in ORDER BY clauses (re-introducing the 20s timeout regression):\n  ${offenders.join('\n  ')}`
    );
  });
});
