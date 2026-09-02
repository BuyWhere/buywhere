// BUY-80026: keyword FTS must isolate currency/country BEFORE pagination.
// Slicing offset first made SG offset=0 empty (all leaks dropped) while
// offset=10 still returned native-currency rows from later in the overfetch.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const mcpTs = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'src', 'routes', 'mcp.ts');

describe('BUY-80026 first-page isolation vs pagination', () => {
  it('keyword FTS does not slice(offset) before market isolation', () => {
    const src = fs.readFileSync(mcpTs, 'utf8');
    const kwStart = src.indexOf('BUY-72082: Keyword (FTS) path via search_products tier');
    assert.ok(kwStart >= 0, 'keyword FTS block missing');
    const kwEnd = src.indexOf('No FTS — browse mode', kwStart);
    assert.ok(kwEnd > kwStart, 'browse-mode marker missing after keyword FTS');
    const kwBlock = src.slice(kwStart, kwEnd);
    assert.equal(
      /slice\(\s*offset\s*,\s*offset\s*\+\s*limit\s*\)/.test(kwBlock),
      false,
      'keyword FTS paginated before currency isolation — SG offset=0 empty-page regression',
    );
  });

  it('isolation paginates with slice(offset, offset + limit)', () => {
    const src = fs.readFileSync(mcpTs, 'utf8');
    const isoStart = src.indexOf('BUY-79497: isolate requested market');
    const isoEnd = src.indexOf('BUY-79642: SEA markets', isoStart);
    const iso = src.slice(isoStart, isoEnd);
    assert.match(iso, /filtered\.slice\(\s*offset\s*,\s*offset\s*\+\s*limit\s*\)/);
    assert.doesNotMatch(iso, /filtered\.slice\(\s*0\s*,\s*limit\s*\)/);
  });
});
