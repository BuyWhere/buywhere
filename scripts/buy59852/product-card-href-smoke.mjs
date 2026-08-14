#!/usr/bin/env node

/**
 * BUY-69750: ProductCard href wiring smoke test.
 *
 * Probes the 3 previously unwired SEO landing pages and asserts product-card
 * anchors route to /products/<country>/<slug>/<id> instead of /search?q=...
 * or direct merchant redirect URLs.
 *
 * Usage:
 *   node scripts/buy59852/product-card-href-smoke.mjs
 *   BASE_URL=http://localhost:3000 node scripts/buy59852/product-card-href-smoke.mjs
 */

const BASE_URL = (process.env.BASE_URL || 'https://buywhere.ai').replace(/\/$/, '');

const PAGES = [
  { path: '/air-purifier-singapore', expectedCountry: 'sg' },
  { path: '/laptop-singapore', expectedCountry: 'sg' },
  { path: '/best-headphones-us', expectedCountry: 'us' },
];

function getAttr(tag, attr) {
  const match = tag.match(new RegExp(`${attr}="([^"]*)"`));
  return match ? match[1] : '';
}

function extractProductCardHrefs(html) {
  return [...html.matchAll(/<a\b[^>]*>/g)]
    .map((match) => match[0])
    .filter((tag) => getAttr(tag, 'class').includes('group grid'))
    .map((tag) => getAttr(tag, 'href'))
    .filter(Boolean);
}

async function fetchHtml(url) {
  const response = await fetch(url, { headers: { Accept: 'text/html' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function testPage({ path, expectedCountry }) {
  const url = `${BASE_URL}${path}`;
  const html = await fetchHtml(url);
  const hrefs = extractProductCardHrefs(html);
  const productHrefs = [...new Set(hrefs.filter((href) => href.startsWith(`/products/${expectedCountry}/`)))];
  const searchHrefs = hrefs.filter((href) => href.startsWith('/search?q='));
  const externalHrefs = hrefs.filter((href) => /^https?:\/\//.test(href));

  return {
    url,
    expectedCountry,
    productCardCount: hrefs.length,
    productHrefCount: productHrefs.length,
    productHrefs,
    searchHrefCount: searchHrefs.length,
    searchHrefs,
    externalHrefCount: externalHrefs.length,
    externalHrefs,
    passed: productHrefs.length >= 1 && searchHrefs.length === 0 && externalHrefs.length === 0,
  };
}

function printResult(result) {
  const status = result.passed ? '✓ PASS' : '✗ FAIL';
  console.log(`${status} ${result.url}`);
  console.log(`  product-card anchors: ${result.productCardCount}`);
  console.log(`  /products/${result.expectedCountry}/ hrefs: ${result.productHrefCount} (>=1 required)`);
  result.productHrefs.slice(0, 8).forEach((href) => console.log(`    - ${href}`));
  console.log(`  product-card /search?q= hrefs: ${result.searchHrefCount} (0 required)`);
  result.searchHrefs.slice(0, 8).forEach((href) => console.log(`    - ${href}`));
  console.log(`  product-card external hrefs: ${result.externalHrefCount} (0 required)`);
  result.externalHrefs.slice(0, 8).forEach((href) => console.log(`    - ${href}`));
  console.log('');
}

async function main() {
  console.log(`BUY-69750 ProductCard href smoke (${BASE_URL})\n`);
  const results = [];

  for (const page of PAGES) {
    try {
      const result = await testPage(page);
      results.push(result);
      printResult(result);
    } catch (error) {
      const result = {
        url: `${BASE_URL}${page.path}`,
        expectedCountry: page.expectedCountry,
        productCardCount: 0,
        productHrefCount: 0,
        productHrefs: [],
        searchHrefCount: 0,
        searchHrefs: [],
        externalHrefCount: 0,
        externalHrefs: [],
        passed: false,
      };
      results.push(result);
      console.error(`✗ FAIL ${result.url}: ${error.message}\n`);
    }
  }

  if (!results.every((result) => result.passed)) {
    console.error('✗ ProductCard href smoke failed.');
    process.exit(1);
  }

  console.log('✓ ProductCard href smoke passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
