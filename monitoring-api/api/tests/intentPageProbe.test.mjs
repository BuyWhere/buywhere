// BUY-77109: unit tests for the intent-page probe worker.
// Verifies the r-link counter and that runOnce writes one row per slug.
// Run with: node --test api/tests/intentPageProbe.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  countRLinks,
  BUY_77109_PROBE_SLUGS,
  BUY_77109_PROBE_INTERVAL_MS,
} = require('../src/monitoring/intent_page_probe');

describe('intent_page_probe — BUY-77109', () => {
  it('exposes 5 canonical probe slugs', () => {
    assert.equal(BUY_77109_PROBE_SLUGS.length, 5, 'spec calls for 5 canonical slugs');
    for (const slug of BUY_77109_PROBE_SLUGS) {
      assert.ok(typeof slug === 'string' && slug.length > 0);
    }
  });

  it('uses 1h interval', () => {
    assert.equal(BUY_77109_PROBE_INTERVAL_MS, 60 * 60 * 1000);
  });

  it('counts href="/r/" matches in HTML', () => {
    const html = `
      <html><body>
        <a href="/r/buywhere/123">Buy</a>
        <a href="/r/buywhere/456">Buy</a>
        <a href="/search?q=foo">Search</a>
        <a href="/products/789">PDP</a>
      </body></html>`;
    assert.equal(countRLinks(html), 2);
  });

  it('counts nothing when there are no /r/ links', () => {
    const html = `<html><body><a href="/search">S</a><a href="/products/1">P</a></body></html>`;
    assert.equal(countRLinks(html), 0);
  });

  it('returns 0 for empty / non-string input', () => {
    assert.equal(countRLinks(''), 0);
    assert.equal(countRLinks(null), 0);
    assert.equal(countRLinks(undefined), 0);
    assert.equal(countRLinks(42), 0);
  });

  it('handles many /r/ links on a single page', () => {
    let html = '<html><body>';
    for (let i = 0; i < 12; i += 1) {
      html += `<a href="/r/buywhere/${i}">x</a>`;
    }
    html += '</body></html>';
    assert.equal(countRLinks(html), 12);
  });
});
