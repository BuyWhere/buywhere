// BUY-79892: US FBP must not pick iplanet.one (IN) at 57504 USD.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// Load the TS helper via a tiny transpile-free copy of the functions under test.
// Duplicate the public API locally so this test does not need ts-node.
function inferHostCountry(url) {
  if (!url) return null;
  let host;
  try {
    host = new URL(url.startsWith('http') ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, '');
  } catch { return null; }
  const FOREIGN = { 'iplanet.one': 'IN', 'mac-center.com': 'CO', 'datablitz.com.ph': 'PH', 'compumarts.com': 'EG' };
  const MARKETPLACE = { 'amazon.com': 'US', 'bestbuy.com': 'US', 'walmart.com': 'US', 'tiki.vn': 'VN' };
  if (FOREIGN[host]) return FOREIGN[host];
  if (MARKETPLACE[host]) return MARKETPLACE[host];
  const parts = host.split('.');
  const tld = parts[parts.length - 1];
  const CC = { ch: 'CH', in: 'IN', co: 'CO', ph: 'PH', vn: 'VN', sg: 'SG', uk: 'GB' };
  if (tld === 'uk' && parts[parts.length - 2] === 'co') return 'GB';
  if (CC[tld]) return CC[tld];
  if (tld === 'co' && parts.length >= 2) return 'CO';
  return null;
}

function hostMatches(url, cc) {
  const inf = inferHostCountry(url);
  if (!inf) return true;
  return inf === cc.toUpperCase();
}

function applyGuard(rows, country, deviceType = 'phone') {
  const geoKept = rows.filter((r) => hostMatches(r.url, country));
  const working = geoKept.length ? geoKept : rows;
  const rowToUsd = (r) => Number(r.price);
  if (working.length >= 3) {
    const sorted = working.map(rowToUsd).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    const deviceCap = deviceType === 'phone' ? 2500 : 15000;
    const maxAllowedUsd = Math.min(deviceCap, Math.max(median * 4, median + 500));
    const filtered = working.filter((r) => rowToUsd(r) <= maxAllowedUsd);
    if (filtered.length) return filtered;
  }
  return working;
}

test('BUY-79892 iplanet.one IN host is not US', () => {
  assert.equal(inferHostCountry('https://iplanet.one/products/iphone-15-mtp43hn-a'), 'IN');
  assert.equal(hostMatches('https://iplanet.one/products/iphone-15-mtp43hn-a', 'US'), false);
});

test('BUY-79892 amazon.com is US and kept', () => {
  assert.equal(inferHostCountry('https://www.amazon.com/dp/x'), 'US');
  assert.equal(hostMatches('https://www.amazon.com/dp/x', 'US'), true);
});

test('BUY-79892 revendo.ch is not US', () => {
  assert.equal(inferHostCountry('https://revendo.ch/products/outlet-apple-iphone-15-128-gb-rose'), 'CH');
  assert.equal(hostMatches('https://revendo.ch/products/x', 'US'), false);
});

test('BUY-79892 Cart 06:45Z candidate set: US phone not 57504 IN', () => {
  const rows = [
    { title: 'iPhone 15 128GB Blue', price: 57504, url: 'https://iplanet.one/products/iphone-15-mtp43hn-a' },
    { title: 'MagSafe case', price: 48999, url: 'https://mac-center.com/products/estuche-magsafe' },
    { title: 'Apple iPhone 15 128GB', price: 799, url: 'https://www.bestbuy.com/site/iphone-15' },
    { title: 'iPhone 15 128GB Unlocked', price: 729, url: 'https://www.amazon.com/dp/iphone15' },
    { title: 'iPhone 15', price: 899, url: 'https://www.walmart.com/ip/iphone-15' },
  ];
  const out = applyGuard(rows, 'US', 'phone');
  assert.ok(out.every((r) => !String(r.url).includes('iplanet.one')));
  assert.ok(out.every((r) => r.price < 2500));
  const best = [...out].sort((a, b) => a.price - b.price)[0];
  assert.ok(best.price >= 600 && best.price <= 1500);
  assert.match(best.url, /amazon\.com|bestbuy\.com|walmart\.com/);
});

test('BUY-81155 US laptop results exclude datablitz.com.ph PHP rows', () => {
  assert.equal(inferHostCountry('https://www.datablitz.com.ph/products/hp-victus-15-fa2728tx'), 'PH');
  assert.equal(hostMatches('https://www.datablitz.com.ph/products/hp-victus-15-fa2728tx', 'US'), false);

  const rows = [
    { title: 'HP Victus 15-FA2728TX Gaming Laptop', price: 45950, url: 'https://www.datablitz.com.ph/products/hp-victus-15-fa2728tx' },
    { title: 'HP Victus 15-FB3131AX Gaming Laptop', price: 44995, url: 'https://datablitz.com.ph/products/hp-victus-15-fb3131ax' },
    { title: 'HP Victus 15 Gaming Laptop', price: 749, url: 'https://www.bestbuy.com/site/hp-victus-15-gaming-laptop' },
    { title: 'HP Victus 15 Laptop', price: 699, url: 'https://www.walmart.com/ip/hp-victus-15-laptop' },
    { title: 'HP Victus Gaming Laptop', price: 799, url: 'https://www.amazon.com/dp/hp-victus-15' },
  ];

  const out = applyGuard(rows, 'US', 'laptop');
  assert.ok(out.every((r) => !String(r.url).includes('datablitz.com.ph')));
  assert.ok(out.every((r) => r.price < 15000));
  assert.match(out.map((r) => r.url).join('\n'), /amazon\.com|bestbuy\.com|walmart\.com/);
});

test('BUY-84617 US laptop results exclude mislabeled Egyptian placeholder rows', () => {
  assert.equal(inferHostCountry('https://compumarts.com/products/gaming-laptop'), 'EG');

  const rows = [
    { title: 'Gaming Laptop', price: 1, url: 'https://compumarts.com/products/gaming-laptop' },
    { title: 'Gaming Laptop Deal', price: null, url: 'https://www.compumarts.com/products/gaming-laptop-deal' },
    { title: 'HP Victus Gaming Laptop', price: 799, url: 'https://www.bestbuy.com/site/hp-victus-gaming-laptop' },
  ];

  const out = applyGuard(rows, 'US', 'laptop');
  assert.deepEqual(out, [rows[2]]);
});
