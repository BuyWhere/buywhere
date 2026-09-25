// BUY-80191: MCP search_products must not emit unpriced rows.
// REST /v1/products/search already uses `price > 0`; MCP FTS/identifier/tier
// paths omitted it, so US child-table Shopify/Woo stubs filled the default
// page of 20 with price.amount=null.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const mcpTs = path.resolve(__dirname, '..', 'src', 'routes', 'mcp.ts');
const source = fs.readFileSync(mcpTs, 'utf8');

describe('BUY-80191: MCP search_products price freshness gate', () => {
  it('handleSearchProducts FTS conditions require price > 0', () => {
    assert.ok(
      /const conditions: string\[\] = \['is_active = true', 'price > 0'\];/.test(source),
      'MCP keyword FTS WHERE must include price > 0 (parity with REST archive)',
    );
  });

  it('tierConditions require sp.price > 0', () => {
    assert.ok(
      /const tierConditions: string\[\] = \['sp\.price > 0'\];/.test(source),
      'search_products / child-table FTS must filter sp.price > 0',
    );
  });

  it('identifier lookup requires price > 0', () => {
    assert.ok(
      /const idConds: string\[\] = \['is_active = true', 'price > 0'\];/.test(source),
      'identifier path must not return unpriced catalog rows',
    );
  });

  it('isolation filter drops null/zero prices (BUY-80191)', () => {
    const iso = source.indexOf('BUY-80191: drop unpriced rows');
    assert.ok(iso > -1, 'isolation filter must drop unpriced rows after currency isolation');
  });

  it('cache key bumped so pre-gate Redis pages cannot poison US search', () => {
    assert.ok(
      /fts:v11:/.test(source),
      'MCP FTS cache key must be v11+ after the price gate',
    );
  });
});
