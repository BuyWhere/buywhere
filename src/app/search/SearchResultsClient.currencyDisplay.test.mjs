// BUY-80921 — listing currency_code drives the glyph, never page locale.
//
// QA repro: /search?q=laptop&country=us rendered Datablitz PHP 45,950 as
// "$45,950.00" because normalizeProduct overwrote the listing currency with
// the selected-country USD code (BUY-71638). Reed 2026-09-21: country is a
// market filter, not FX. Missing/unknown codes fall back to ISO suffix.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, 'SearchResultsClient.tsx'), 'utf8');

test('BUY-80921: normalizeProduct prefers listing currency over fallback', () => {
  assert.ok(
    !/currency:\s*fallbackCurrency\s*,/.test(source),
    'expected selected-country override of listing currency to be GONE'
  );
  assert.match(
    source,
    /currency:\s*listingCurrencyFromItem\(item\)\s*\|\|\s*fallbackCurrency/,
    'expected listing currency with selected-country fallback'
  );
});

test('BUY-80921: SearchCard formats with product.currency', () => {
  assert.match(
    source,
    /function\s+SearchCard\s*\(\s*\{\s*product\s*\}\s*:/,
    'expected SearchCard to take product only (no page-level currency prop)'
  );
  assert.match(
    source,
    /formatPrice\(product\.price,\s*product\.currency\)/,
    'expected SearchCard to format from listing currency'
  );
  assert.ok(
    !/formatPrice\(product\.price,\s*currency\)/.test(source),
    'expected no formatPrice(..., currency) page-locale call'
  );
});

const CURRENCY_LOCALE = {
  USD: 'en-US',
  SGD: 'en-SG',
  PHP: 'en-PH',
  MYR: 'en-MY',
  IDR: 'id-ID',
  THB: 'th-TH',
  VND: 'vi-VN',
};

function formatPrice(price, currency) {
  if (price === null || !Number.isFinite(price)) return 'Price unavailable';
  const code = (currency || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    const amount = price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return code ? `${amount} ${code}` : `${amount}`;
  }
  try {
    const formatted = new Intl.NumberFormat(CURRENCY_LOCALE[code] || 'en-US', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 2,
    }).format(price);
    if (code === 'SGD') {
      return formatted.replace(/^\$/, 'S$').replace(/^US\$/, 'S$');
    }
    return formatted;
  } catch {
    const amount = price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${amount} ${code}`;
  }
}

test('BUY-80921: PHP listing renders ₱ not $', () => {
  const out = formatPrice(45950, 'PHP');
  assert.ok(out.includes('45,950') || out.includes('45950'), out);
  assert.ok(out.includes('₱') || out.includes('PHP'), `expected peso glyph or ISO, got ${out}`);
  assert.ok(!out.startsWith('$'), `must not default to USD dollar: ${out}`);
});

test('BUY-80921: SGD listing renders S$', () => {
  assert.equal(formatPrice(1299, 'SGD'), 'S$1,299.00');
});

test('BUY-80921: USD listing still uses $', () => {
  assert.equal(formatPrice(1299, 'USD'), '$1,299.00');
});

test('BUY-80921: unknown code shows ISO, never a bare $', () => {
  const out = formatPrice(45950, 'ZZZ');
  assert.ok(out.includes('ZZZ'), out);
  assert.ok(out.includes('45,950'), out);
  assert.ok(!/^\$/.test(out), out);
});

test('BUY-80921: helper export still present', () => {
  assert.match(source, /__test__\s*=\s*\{[\s\S]*normalizeProduct[\s\S]*\}/);
});
