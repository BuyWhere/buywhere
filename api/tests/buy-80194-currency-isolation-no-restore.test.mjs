// BUY-80194: REST tryTierSearch must not restore foreign-currency child FTS
// rows when isolation empties the page (PHP-priced generics on US+SG).
// Paginate AFTER isolation (parity with MCP BUY-80026).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const productsTs = path.resolve(__dirname, '..', 'src', 'routes', 'products.ts');
const source = fs.readFileSync(productsTs, 'utf8');

const tierStart = source.indexOf('async function tryTierSearch(');
assert.ok(tierStart > -1, 'tryTierSearch missing');
const tierEnd = source.indexOf('async function getCachedQueryEmbedding', tierStart);
const tier = source.slice(tierStart, tierEnd);

describe('BUY-80194: REST tier currency isolation never restores leaks', () => {
  it('does not restore unfiltered child hits when isolation empties the page', () => {
    assert.equal(
      /useChildTable && wantCur && served\.length === 0/.test(tier),
      false,
      'BUY-79827 restore path must not re-emit PHP/USD leaks on US+SG',
    );
    assert.ok(
      /BUY-80194: never restore/.test(tier),
      'isolation filter must document BUY-80194 no-restore',
    );
  });

  it('paginates after isolation (slice offset, offset+limit)', () => {
    assert.match(tier, /isolated\.slice\(\s*p\.offset\s*,\s*p\.offset\s*\+\s*p\.limit\s*\)/);
    assert.doesNotMatch(
      tier,
      /LIMIT \$\{limitIdx\} OFFSET \$\{offsetIdx\}/,
    );
  });

  it('cache version bumped so pre-fix Redis pages cannot poison US/SG', () => {
    // Slice above starts at tryTierSearch (which is below the cache version
    // constant). Match the cache version across the full file.
    // BUY-80190 may supersede the b80194 tag in the cache version string.
    assert.match(
      source,
      /SG_SEARCH_FRESHNESS_GUARDRAIL_CACHE_VERSION\s*=\s*'tier-child-fts-v\d+-b(?:80194|80190)'/,
    );
  });
});
