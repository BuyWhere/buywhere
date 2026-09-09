// BUY-78311: Ingest currency validation tests.
//
// Tests that the currency validation rejects rows where stored currency does not
// match the expected currency for the merchant's country.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCurrencyForCountry, COUNTRY_TO_CURRENCY } from '../dist/routes/ingest.js';

test('validateCurrencyForCountry accepts matching currency for country', () => {
  const result = validateCurrencyForCountry('MYR', 'MY', 'test_merchant');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.reason, undefined);
});

test('validateCurrencyForCountry accepts matching currency (case insensitive)', () => {
  const result = validateCurrencyForCountry('myr', 'my', 'test_merchant');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.reason, undefined);
});

test('validateCurrencyForCountry accepts matching currency for SG', () => {
  const result = validateCurrencyForCountry('SGD', 'SG', 'test_merchant');
  assert.strictEqual(result.valid, true);
});

test('validateCurrencyForCountry accepts matching currency for US', () => {
  const result = validateCurrencyForCountry('USD', 'US', 'test_merchant');
  assert.strictEqual(result.valid, true);
});

test('validateCurrencyForCountry accepts matching currency for TH', () => {
  const result = validateCurrencyForCountry('THB', 'TH', 'test_merchant');
  assert.strictEqual(result.valid, true);
});

test('validateCurrencyForCountry accepts matching currency for PH', () => {
  const result = validateCurrencyForCountry('PHP', 'PH', 'test_merchant');
  assert.strictEqual(result.valid, true);
});

test('validateCurrencyForCountry accepts matching currency for ID', () => {
  const result = validateCurrencyForCountry('IDR', 'ID', 'test_merchant');
  assert.strictEqual(result.valid, true);
});

test('validateCurrencyForCurrency accepts matching currency for VN', () => {
  const result = validateCurrencyForCountry('VND', 'VN', 'test_merchant');
  assert.strictEqual(result.valid, true);
});

test('validateCurrencyForCountry rejects mismatched currency (BUY-78311 scenario)', () => {
  const result = validateCurrencyForCountry('USD', 'MY', 'shopify_buy30620_crate');
  assert.strictEqual(result.valid, false);
  assert.ok(result.reason?.includes('MYR'));
  assert.ok(result.reason?.includes('USD'));
});

test('validateCurrencyForCountry accepts when no country_code', () => {
  const result = validateCurrencyForCountry('USD', undefined, 'test_merchant');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.reason, undefined);
});

test('validateCurrencyForCountry accepts when no country_code (null)', () => {
  const result = validateCurrencyForCountry('USD', null, 'test_merchant');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.reason, undefined);
});

test('validateCurrencyForCountry accepts for unknown country_code', () => {
  const result = validateCurrencyForCountry('EUR', 'XX', 'test_merchant');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.reason, undefined);
});

test('COUNTRY_TO_CURRENCY has expected mappings', () => {
  assert.strictEqual(COUNTRY_TO_CURRENCY.MY, 'MYR');
  assert.strictEqual(COUNTRY_TO_CURRENCY.SG, 'SGD');
  assert.strictEqual(COUNTRY_TO_CURRENCY.US, 'USD');
  assert.strictEqual(COUNTRY_TO_CURRENCY.TH, 'THB');
  assert.strictEqual(COUNTRY_TO_CURRENCY.PH, 'PHP');
  assert.strictEqual(COUNTRY_TO_CURRENCY.ID, 'IDR');
  assert.strictEqual(COUNTRY_TO_CURRENCY.VN, 'VND');
});