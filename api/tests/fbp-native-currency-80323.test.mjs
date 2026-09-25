// BUY-80323: MY FBP must not leak USD on machines.com.my AppleCare.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const COUNTRY_CURRENCY = {
  SG: 'SGD', US: 'USD', MY: 'MYR', TH: 'THB', VN: 'VND', ID: 'IDR', PH: 'PHP',
};

function extractRowCurrency(row) {
  if (!row) return '';
  const offers = row.offers;
  if (offers && typeof offers === 'object' && !Array.isArray(offers)) {
    const c = offers.priceCurrency ?? offers.currency;
    if (typeof c === 'string' && c.trim()) return c.trim().toUpperCase();
  }
  const nested = row.price;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const c = nested.currency ?? nested.priceCurrency;
    if (typeof c === 'string' && c.trim()) return c.trim().toUpperCase();
  }
  for (const key of ['currency', 'priceCurrency']) {
    const c = row[key];
    if (typeof c === 'string' && c.trim()) return c.trim().toUpperCase();
  }
  return '';
}

function filterNativeCurrencyRows(rows, country) {
  const want = (COUNTRY_CURRENCY[country] || '').toUpperCase();
  if (!want || rows.length === 0) return rows;
  const nativeOrUnknown = rows.filter((r) => {
    const cur = extractRowCurrency(r);
    return !cur || cur === want;
  });
  const knownNative = nativeOrUnknown.filter((r) => extractRowCurrency(r) === want);
  if (knownNative.length > 0) return nativeOrUnknown;
  const mismatched = rows.some((r) => {
    const cur = extractRowCurrency(r);
    return cur && cur !== want;
  });
  if (mismatched) return [];
  return rows;
}

const FBP_WARRANTY_PATTERN = /\b(applecare|apple care|warranty|service plan|care\+|protection plan|extended warranty)\b/i;
function rankFbpHardwareFirst(rows) {
  return [...rows].sort((a, b) => {
    const aW = FBP_WARRANTY_PATTERN.test(String(a.title || a.name || '')) ? 1 : 0;
    const bW = FBP_WARRANTY_PATTERN.test(String(b.title || b.name || '')) ? 1 : 0;
    return aW - bW;
  });
}

test('BUY-80323 drops USD AppleCare leak when MYR hardware exists', () => {
  const rows = [
    {
      title: 'AppleCare+ for Headphones - AirPods Pro 2-year plan',
      url: 'https://machines.com.my/products/applecare-for-headphones-airpods-pro-2-year-plan',
      price: { amount: 149, currency: 'USD' },
      merchant: 'shopify',
    },
    {
      title: 'Apple AirPods Pro (2nd generation)',
      url: 'https://www.lazada.com.my/products/airpods-pro',
      price: { amount: 899, currency: 'MYR' },
      merchant: 'lazada',
    },
  ];
  const native = filterNativeCurrencyRows(rows, 'MY');
  assert.equal(native.length, 1);
  assert.equal(extractRowCurrency(native[0]), 'MYR');
  const ranked = rankFbpHardwareFirst(native);
  assert.match(String(ranked[0].title), /AirPods Pro \(2nd/);
});

test('BUY-80323 empty rather than leak USD-only MY page', () => {
  const rows = [
    {
      title: 'AppleCare+ for Headphones - AirPods Pro 2-year plan',
      url: 'https://machines.com.my/products/applecare-for-headphones-airpods-pro-2-year-plan',
      currency: 'USD',
      price: 149,
    },
  ];
  const native = filterNativeCurrencyRows(rows, 'MY');
  assert.equal(native.length, 0);
});

test('BUY-80323 ranks hardware before AppleCare when currency already native', () => {
  const rows = [
    { title: 'AppleCare+ for AirPods Pro', price: { amount: 399, currency: 'MYR' } },
    { title: 'Apple AirPods 4', price: { amount: 599, currency: 'MYR' } },
  ];
  const ranked = rankFbpHardwareFirst(filterNativeCurrencyRows(rows, 'MY'));
  assert.equal(ranked[0].title, 'Apple AirPods 4');
});

test('BUY-80323 nested offers.priceCurrency USD is detected', () => {
  const row = { offers: { lowPrice: 149, priceCurrency: 'USD' }, title: 'x' };
  assert.equal(extractRowCurrency(row), 'USD');
});
