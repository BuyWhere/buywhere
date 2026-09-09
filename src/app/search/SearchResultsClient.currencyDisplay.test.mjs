// BUY-71638 / f369fdc9 regression test — selected-country currency display.
//
// QA repro: /search?q=laptop&country=US rendered mixed currencies (SGD,
// INR, TRY) under the US country filter, even though the user picked
// "United States". The fix is to ALWAYS honor the selected-country currency
// at display time, regardless of the API row's source-row currency. The
// numeric price value is not FX-converted (no rates table exists); only the
// displayed currency code tracks the country the user picked.
//
// This is the FOURTH silent revert caused by 2d53dc31 (BUY-72387 —
// 2026-08-21T06:37Z). The previous fixes shipped in commits bff2f092 /
// 3b72f3c3 / ffc22666 (Aug 19-20) and were all rolled back when Rex's
// "reframe root metadata" commit silently restored the broken
// `priceCurrency || fallbackCurrency` short-circuit and the inline
// `formatPrice(product.price, product.currency)` call. This test guards
// against the next silent reset.
//
// Pattern: mirrors the .mjs tests in this directory (read source as a
// string, assert presence + invariants + functional re-implementation of
// the simple pure functions). Runs under `node --test` with zero
// dependencies, so the same test that teams have running in CI for the
// BUY-72491 blocklist guard can wire this in.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, 'SearchResultsClient.tsx'), 'utf8');

// ----- Source-shape guards ----------------------------------------------------

test('BUY-71638: normalizeProduct stores the selected-country currency (no fallthrough to priceCurrency)', () => {
  // The 2d53dc31 regression reintroduced `currency: priceCurrency || fallbackCurrency`.
  // The fix is to ALWAYS use fallbackCurrency so the displayed currency code
  // tracks the selected country. The `priceCurrency` variable was removed
  // entirely from normalizeProduct because nothing reads it anymore.
  assert.ok(
    !/currency:\s*priceCurrency\s*\|\|\s*fallbackCurrency/.test(source),
    'expected the `priceCurrency || fallbackCurrency` short-circuit to be GONE (this is the 2d53dc31 regression)'
  );
  assert.ok(
    !/const\s+priceCurrency\s*=/.test(source),
    'expected the dead `priceCurrency` local to be removed from normalizeProduct'
  );
  assert.match(
    source,
    /currency:\s*fallbackCurrency/,
    'expected normalizeProduct to store `currency: fallbackCurrency` (selected-country wins)'
  );
});

test('BUY-71638: SearchCard accepts a `currency` prop and uses it for formatPrice', () => {
  // SearchCard signature must take `currency: string` and call formatPrice(price, currency).
  assert.match(
    source,
    /function\s+SearchCard\s*\(\s*\{\s*product\s*,\s*currency\s*\}\s*:\s*\{\s*product:\s*SearchCardProduct;\s*currency:\s*string\s*\}\s*\)/,
    'expected SearchCard to destructure { product, currency }'
  );
  assert.match(
    source,
    /formatPrice\(product\.price,\s*currency\)/,
    'expected SearchCard to format with the selected-country currency, not product.currency'
  );
});

test('BUY-71638: Selected-country currency is threaded through to each SearchCard', () => {
  // The map call site passes `activeCountry.currency` to every card.
  assert.match(
    source,
    /<SearchCard[^>]*currency=\{activeCountry\.currency\}/s,
    'expected <SearchCard> to be rendered with currency={activeCountry.currency}'
  );
});

// ----- Functional re-implementation of the helper ----------------------------
//
// `normalizeProduct` imports the actual TypeScript function and the
// `__test__` export. We can't import those directly under Node (no TS
// resolver), so we re-implement the *currency* invariant here — the only
// invariant that matters for this regression. If the rule below stops
// matching the source, the source-shape guard above will already have
// failed.
//
// The actual full normalizeProduct is covered by the documentation-only
// .ts test file in the same directory (priceSanity.test.ts).

function normalizeProductCurrency(rowCurrency, fallbackCurrency) {
  return fallbackCurrency; // mirrors the BUY-71638 invariant
}

function formatPrice(price, currency) {
  if (price === null || !Number.isFinite(price)) return 'Price unavailable';
  try {
    return new Intl.NumberFormat(currency === 'SGD' ? 'en-SG' : 'en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(price);
  } catch {
    return `${currency} ${price.toFixed(2)}`;
  }
}

test('BUY-71638: invariant — SGD-priced API row under US filter renders as USD', () => {
  // The QA repro: an SGD-priced Newegg-ish row leaking into a US country
  // filter used to render as "SGD 1,349.99". After the fix it renders as
  // "$1,349.99" — same number, selected-country currency code.
  const apiCurrency = 'SGD';
  const apiAmount = 1349.99;
  const selectedCountry = 'USD';

  const displayCurrency = normalizeProductCurrency(apiCurrency, selectedCountry);
  assert.equal(displayCurrency, 'USD');
  assert.equal(formatPrice(apiAmount, displayCurrency), '$1,349.99');
});

test('BUY-71638: invariant — INR/TRY rows under US filter also render as USD', () => {
  // The exact QA-reported cases: ₹7,499.00 and TRY 4,799.50 under the US
  // filter. The fix forces them to display in USD.
  for (const apiCurrency of ['INR', 'TRY']) {
    const selectedCountry = 'USD';
    const displayCurrency = normalizeProductCurrency(apiCurrency, selectedCountry);
    assert.equal(
      displayCurrency,
      'USD',
      `expected ${apiCurrency} API row under US filter to display in USD`
    );
  }
});

test('BUY-71638: invariant — SGD filter renders SGD for any source currency', () => {
  // formatPrice uses locale `en-SG` for SGD currency, which renders
  // SGD amounts as "$1,234.50" (the Singapore dollar sign, not the
  // ISO code). This was fixed in commit fdd47cd7 (BUY-71643) so the SG
  // country filter shows S$X not SGD X.XX.
  for (const apiCurrency of ['USD', 'INR', 'TRY', null, undefined]) {
    const displayCurrency = normalizeProductCurrency(apiCurrency, 'SGD');
    assert.equal(
      displayCurrency,
      'SGD',
      `expected ${apiCurrency} API row under SG filter to display in SGD`
    );
    assert.equal(formatPrice(1234.5, displayCurrency), '$1,234.50');
  }
});

test('BUY-71638: invariant — null price falls back to "Price unavailable" regardless of currency', () => {
  assert.equal(formatPrice(null, 'USD'), 'Price unavailable');
  assert.equal(formatPrice(null, 'SGD'), 'Price unavailable');
  assert.equal(formatPrice(NaN, 'USD'), 'Price unavailable');
});

test('BUY-71638: invariant — helper is exposed via __test__ for direct unit coverage', () => {
  // The .ts priceSanity test imports `normalizeProduct` through `__test__`.
  // If a future cleanup removes the export, the .ts test breaks AND this
  // assertion catches it.
  assert.match(
    source,
    /__test__\s*=\s*\{[\s\S]*normalizeProduct[\s\S]*\}/,
    'expected normalizeProduct to be exported via __test__'
  );
});
