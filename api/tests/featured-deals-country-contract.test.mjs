// BUY-81330 contract guard: featured and deals must be market-scoped and
// currency-consistent. Source-level assertions pin the exact SQL gate and
// currency derivation; the live behavior was verified in the heartbeat.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const productsSrc = readFileSync(path.join(__dirname, '..', 'src', 'routes', 'products.ts'), 'utf-8');

function routeBody(marker) {
  const start = productsSrc.indexOf(marker);
  assert.ok(start >= 0, `route marker ${marker} not found`);
  const next = productsSrc.indexOf('router.get(', start + marker.length);
  return productsSrc.slice(start, next > 0 ? next : start + 12000);
}

test('featured defaults to SG and enforces country + currency consistency', () => {
  const body = routeBody("'/featured',");
  assert.match(body, /COUNTRY_CURRENCY\[countryCode\]\s*\|\|\s*'SGD'/);
  assert.match(body, /country_code\s*=\s*\$1/);
});

test('deals infers buyer currency and enforces country + currency consistency', () => {
  const body = routeBody("'/deals',");
  assert.match(body, /COUNTRY_CURRENCY\[countryCode\]/);
  assert.match(body, /COUNTRY_CURRENCY\[deliverTo\]/);
  assert.match(body, /country_code\s*=\s*\$\$\{dealIdx\}/);
  assert.match(body, /country_code\s*=\s*ANY\(\$\$\{dealIdx\}::text\[\]\)/);
});
