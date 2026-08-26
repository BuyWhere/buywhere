import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { preprocessSearchQuery } = require('../dist/lib/queryPreprocessor');

describe('query preprocessor SEO boilerplate normalization', () => {
  it('keeps product intent from intent-page title queries', () => {
    const cases = new Map([
      ['best wireless earbuds in Singapore 2026', 'wireless earbuds'],
      ['Best MacBook deals in SG 2026', 'MacBook'],
      ['rice cooker Singapore review guide', 'rice cooker'],
      ['multi cooker for United States 2026', 'multi cooker'],
      ['ps5 online comparison', 'ps5'],
    ]);

    for (const [query, expected] of cases) {
      assert.equal(preprocessSearchQuery(query).cleanedQuery, expected);
    }
  });
});
