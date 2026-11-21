#!/usr/bin/env node
/**
 * scripts/shopee_vn_scraper.mjs — BUY-40828 Shopee Vietnam scraper
 *
 * Scrapes product listings from shopee.vn across multiple categories
 * and writes NDJSON to data/affiliate_ndjson/shopee_vn.ndjson.
 *
 * Proxy chain (same as shopee_my_scraper.mjs):
 *   1. ScraperAPI ultra_premium  (SCRAPERAPI_KEY)
 *   2. BrightData super proxy    (BRIGHTDATA_SB_*)
 *   3. Direct fallback
 *
 * Usage:
 *   node scripts/shopee_vn_scraper.mjs --scrape-only
 *   node scripts/shopee_vn_scraper.mjs --api-key <key> [--api-base http://localhost:8000]
 */

import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const MERCHANT_ID = 'shopee_vn';
const SOURCE = 'shopee_vn';
const BASE_URL = 'https://shopee.vn';
const DEFAULT_OUTPUT = 'data/affiliate_ndjson/shopee_vn.ndjson';
const PAGE_SIZE = 60;

// ---------------------------------------------------------------------------
// Proxy resolution — mirrors shopee_my_scraper.mjs
// ---------------------------------------------------------------------------

function resolveProxyConfig() {
  const proxy = String(process.env.SHOPEE_PROXY_URL || '').trim();
  if (proxy) return { url: proxy, kind: 'generic' };

  const saKey = String(process.env.SCRAPERAPI_KEY || '').trim();
  if (saKey) {
    const ultra = String(process.env.SCRAPERAPI_ULTRA || 'true').toLowerCase() !== 'false';
    const params = new URLSearchParams({
      url: 'INJECT_TARGET_URL',
      country_code: 'vn',
      api_key: saKey,
    });
    if (ultra) params.set('ultra_premium', 'true');
    return { url: `https://api.scraperapi.com/?${params.toString()}`, kind: 'scraperapi' };
  }

  const bdHost = String(process.env.BRIGHTDATA_SB_HOST || '').trim();
  const bdUser = String(process.env.BRIGHTDATA_SB_USERNAME || '').trim();
  const bdPass = String(process.env.BRIGHTDATA_SB_PASSWORD || '').trim();
  const bdPort = String(process.env.BRIGHTDATA_SB_PORT || '9222').trim();
  if (bdHost && bdUser && bdPass) {
    return {
      url: `http://${bdUser}:${bdPass}@${bdHost}:${bdPort}`,
      kind: 'brightdata',
    };
  }

  return { url: '', kind: 'direct' };
}

const PROXY = resolveProxyConfig();

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
  Referer: `${BASE_URL}/`,
  'X-Shopee-Language': 'vi',
};

if (process.env.SHOPEE_VN_COOKIE) {
  HEADERS.Cookie = process.env.SHOPEE_VN_COOKIE;
}

function buildScraperApiUrl(targetUrl) {
  if (PROXY.kind !== 'scraperapi') return targetUrl;
  return PROXY.url.replace('INJECT_TARGET_URL', encodeURIComponent(targetUrl));
}

function detectProxyError(response, text) {
  if (PROXY.kind !== 'scraperapi') return null;
  if (response.status === 403 && text.includes('ultra_premium')) {
    return 'ScraperAPI requires ultra_premium=true for Shopee VN (30 credits/request).';
  }
  if (text.includes('credits') || text.includes('api_key') || text.includes('not authorized')) {
    return `ScraperAPI error: ${text.slice(0, 120)}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shopee VN categories
// ---------------------------------------------------------------------------

const CATEGORIES = [
  { id: 'electronics-phones', name: 'Electronics', sub: 'Phones', catid: '11005815' },
  { id: 'electronics-tablets', name: 'Electronics', sub: 'Tablets', catid: '11006327' },
  { id: 'electronics-laptops', name: 'Electronics', sub: 'Laptops', catid: '11006326' },
  { id: 'electronics-audio', name: 'Electronics', sub: 'Audio', catid: '11005814' },
  { id: 'electronics-cameras', name: 'Electronics', sub: 'Cameras', catid: '11006328' },
  { id: 'electronics-accessories', name: 'Electronics', sub: 'Mobile Accessories', catid: '11005816' },
  { id: 'home-kitchen', name: 'Home Appliances', sub: 'Kitchen Appliances', catid: '11006338' },
  { id: 'home-cleaning', name: 'Home Appliances', sub: 'Cleaning Appliances', catid: '11006339' },
  { id: 'home-cooling', name: 'Home Appliances', sub: 'Cooling Appliances', catid: '11006341' },
  { id: 'home-fans', name: 'Home Appliances', sub: 'Fans', catid: '11006340' },
  { id: 'food-groceries', name: 'Food & Beverages', sub: 'Groceries', catid: '11006342' },
  { id: 'food-snacks', name: 'Food & Beverages', sub: 'Snacks', catid: '11006343' },
  { id: 'food-drinks', name: 'Food & Beverages', sub: 'Beverages', catid: '11006344' },
  { id: 'health-supplements', name: 'Health & Beauty', sub: 'Supplements', catid: '11006345' },
  { id: 'health-personal', name: 'Health & Beauty', sub: 'Personal Care', catid: '11006346' },
  { id: 'health-skincare', name: 'Health & Beauty', sub: 'Skincare', catid: '11006347' },
  { id: 'pet-food', name: 'Pet Supplies', sub: 'Pet Food', catid: '11006348' },
  { id: 'pet-accessories', name: 'Pet Supplies', sub: 'Pet Accessories', catid: '11006349' },
];

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    apiBase: 'http://localhost:8000',
    apiKey: process.env.BUYWHERE_API_KEY || '',
    batchSize: 100,
    delay: 1000,
    scrapeOnly: false,
    output: DEFAULT_OUTPUT,
    maxProducts: 0,
    maxPagesPerCategory: 5000,
    categories: [],
    failOnEmpty: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    switch (arg) {
      case '--api-key':
        args.apiKey = next() || '';
        break;
      case '--api-base':
        args.apiBase = next() || args.apiBase;
        break;
      case '--batch-size':
        args.batchSize = Number(next() || args.batchSize);
        break;
      case '--delay':
        args.delay = Number(next() || args.delay);
        break;
      case '--scrape-only':
        args.scrapeOnly = true;
        break;
      case '--output':
        args.output = next() || args.output;
        break;
      case '--max-products':
        args.maxProducts = Number(next() || 0);
        break;
      case '--max-pages-per-category':
        args.maxPagesPerCategory = Number(next() || args.maxPagesPerCategory);
        break;
      case '--category':
        args.categories.push(next());
        break;
      case '--fail-on-empty':
        args.failOnEmpty = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.scrapeOnly && !args.apiKey) {
    throw new Error('Missing --api-key or BUYWHERE_API_KEY. Use --scrape-only to write NDJSON only.');
  }

  args.batchSize = Math.max(1, args.batchSize || 100);
  args.delay = Math.max(0, args.delay || 0);
  args.maxPagesPerCategory = Math.max(1, args.maxPagesPerCategory || 5000);
  return args;
}

function printHelp() {
  console.log(`Shopee VN scraper — BUY-40828

Usage:
  node scripts/shopee_vn_scraper.mjs --scrape-only
  node scripts/shopee_vn_scraper.mjs --api-key <key> [--api-base http://localhost:8000]

Options:
  --scrape-only                 Write NDJSON without ingesting
  --output <path>               NDJSON path (default: ${DEFAULT_OUTPUT})
  --api-key <key>               BuyWhere API key
  --api-base <url>              BuyWhere API base URL
  --batch-size <n>              Write/ingest batch size (default: 100)
  --delay <ms>                  Delay between requests/batches (default: 1000)
  --max-products <n>            Stop after n transformed products; 0 means unlimited
  --max-pages-per-category <n>  Page cap per category (default: 5000)
  --category <id>               Restrict to category id; repeatable
  --fail-on-empty               Exit non-zero if no products are scraped

Environment:
  SHOPEE_VN_COOKIE              Optional Shopee browser/session cookie for anti-bot-gated runs
`);
}

// ---------------------------------------------------------------------------
// BrightData CONNECT proxy via undici — loaded lazily only when needed.
// ---------------------------------------------------------------------------

let _undiciFetch = null;
async function getUndiciFetch() {
  if (!_undiciFetch) {
    const { fetch: uFetch, ProxyAgent } = await import('undici');
    const agent = new ProxyAgent({
      uri: PROXY.url,
      connect: { timeout: 30_000 },
    });
    _undiciFetch = (url, opts) => uFetch(url, { ...opts, dispatcher: agent });
  }
  return _undiciFetch;
}

// ---------------------------------------------------------------------------
// Fetch with retry
// ---------------------------------------------------------------------------

async function fetchJsonWithRetry(rawUrl, retries = 3) {
  const resolvedUrl = buildScraperApiUrl(rawUrl);
  let lastError;
  let lastText = '';

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const fetchFn =
        PROXY.kind === 'brightdata'
          ? await getUndiciFetch()
          : (u, o) => fetch(u, { ...o });

      const response = await fetchFn(resolvedUrl, { headers: HEADERS });
      lastText = await response.text();

      const proxyError = detectProxyError(response, lastText);
      if (proxyError) throw new Error(proxyError);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      try {
        return JSON.parse(lastText);
      } catch {
        throw new Error(`Non-JSON response (${lastText.length} chars): ${lastText.slice(0, 200)}`);
      }
    } catch (error) {
      lastError = error;
      const terminal =
        /credits|api_key|not authorized|Invalid Auth|requires ultra_premium/i.test(error.message);
      if (terminal) throw error;
      if (attempt < retries - 1) {
        await sleep(2 ** attempt * 1000);
      }
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Page fetching — Shopee VN API v4 (same API shape as MY, different catids)
// ---------------------------------------------------------------------------

async function fetchProductsPage(category, page) {
  const url = new URL('/api/v4/search/search_items', BASE_URL);
  url.searchParams.set('keyword', '');
  url.searchParams.set('order', 'desc');
  url.searchParams.set('page_type', 'search');
  url.searchParams.set('scenario', 'PAGE_CATEGORY');
  url.searchParams.set('catid', category.catid);
  url.searchParams.set('page_size', String(PAGE_SIZE));
  url.searchParams.set('offset', String((page - 1) * PAGE_SIZE));

  const data = await fetchJsonWithRetry(url.toString());
  return data?.items || [];
}

// ---------------------------------------------------------------------------
// Product transformation
// ---------------------------------------------------------------------------

function normalizePrice(rawPrice) {
  // Shopee stores prices as integers × 100000 (VND)
  const value = typeof rawPrice === 'string' ? Number(rawPrice) : rawPrice;
  return Number.isFinite(value) ? value / 100_000 : 0;
}

function parseDiscount(rawDiscount) {
  const match = String(rawDiscount || '').match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

function looksLikeGtin(value) {
  const normalized = String(value || '').replace(/[\s-]/g, '');
  return /^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(normalized);
}

function transformProduct(raw, category) {
  const item = raw.item_basic || raw;
  const shopid = String(item.shopid || '');
  const itemid = String(item.itemid || '');
  const title = item.name || item.title || '';

  if (!shopid || !itemid || !title) return null;

  const images = Array.isArray(item.images) ? item.images : [];
  const price = normalizePrice(item.price || 0);
  const originalPrice = item.original_price ? normalizePrice(item.original_price) : price;

  // Shopee VN image CDN: https://cf-shopee-vn.file.getshopee.com/file/
  const imageUrl = images.length > 0 ? `https://cf-shopee-vn.file.getshopee.com/file/${images[0]}` : '';

  return {
    sku: `SVN_${shopid}_${itemid}`,
    gtin: looksLikeGtin(item.item_sku) ? String(item.item_sku) : '',
    mpn: item.mpn || '',
    merchant_id: MERCHANT_ID,
    title,
    description: '',
    price,
    currency: 'VND',
    url: `${BASE_URL}/product/${shopid}/${itemid}`,
    image_url: imageUrl,
    category: category.name,
    category_path: [category.name, category.sub],
    brand: item.brand || item.brand_name || '',
    is_active: true,
    metadata: {
      original_price: originalPrice,
      discount_pct: parseDiscount(item.discount),
      rating: item.rating_star || 0,
      review_count: item.cmt_count || item.rating_count || 0,
      location: item.location || '',
      has_variants: Array.isArray(item.tier_variations) && item.tier_variations.length > 0,
      shopid,
      itemid,
      shopee_catid: category.catid,
      country_code: 'VN',    // required for ingest partition
      region: 'VN',          // required for ingest partition
      source: SOURCE,
    },
  };
}

// ---------------------------------------------------------------------------
// Product sink (NDJSON writer + optional API ingest)
// ---------------------------------------------------------------------------

class ProductSink {
  constructor(args) {
    this.args = args;
    this.outputPath = resolve(args.output);
    this.stream = null;
  }

  open() {
    const outputDir = dirname(this.outputPath);
    if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
    this.stream = createWriteStream(this.outputPath, { flags: 'w', encoding: 'utf8' });
  }

  async writeBatch(products) {
    if (products.length === 0) return { inserted: 0, updated: 0, failed: 0 };

    if (this.args.scrapeOnly) {
      for (const product of products) {
        this.stream.write(`${JSON.stringify(product)}\n`);
      }
      return { inserted: products.length, updated: 0, failed: 0 };
    }

    const response = await fetch(`${this.args.apiBase.replace(/\/$/, '')}/v1/ingest/products`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.args.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ source: SOURCE, products }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ingestion failed: HTTP ${response.status} ${body}`);
    }

    const result = await response.json();
    return {
      inserted: result.rows_inserted || 0,
      updated: result.rows_updated || 0,
      failed: result.rows_failed || 0,
    };
  }

  async close() {
    if (!this.stream) return;
    await new Promise((resolveClose, rejectClose) => {
      this.stream.end((error) => (error ? rejectClose(error) : resolveClose()));
    });
  }
}

// ---------------------------------------------------------------------------
// Main run loop
// ---------------------------------------------------------------------------

async function run(args) {
  const categoryFilter = new Set(args.categories.filter(Boolean));
  const categories = categoryFilter.size
    ? CATEGORIES.filter((category) => categoryFilter.has(category.id))
    : CATEGORIES;

  if (categories.length === 0) {
    throw new Error(`No categories matched: ${Array.from(categoryFilter).join(', ')}`);
  }

  const sink = new ProductSink(args);
  sink.open();

  const summary = { scraped: 0, inserted: 0, updated: 0, failed: 0, page_errors: 0, output: sink.outputPath };
  let batch = [];

  async function flushBatch() {
    if (batch.length === 0) return;
    const result = await sink.writeBatch(batch);
    summary.inserted += result.inserted;
    summary.updated += result.updated;
    summary.failed += result.failed;
    batch = [];
  }

  try {
    console.log('Shopee VN scraper starting — BUY-40828');
    console.log(`Mode: ${args.scrapeOnly ? 'scrape-only NDJSON' : `ingest ${args.apiBase}`}`);
    console.log(`Proxy: ${PROXY.kind}${PROXY.kind === 'scraperapi' ? ' (ultra_premium enabled)' : ''}`);
    console.log(`Output: ${sink.outputPath}`);
    console.log(`Categories: ${categories.length}; target: ${args.maxProducts || 'unlimited'} products`);

    for (const category of categories) {
      let page = 1;
      let consecutiveEmpty = 0;
      console.log(`\n[${category.name} / ${category.sub}] Starting...`);

      while (consecutiveEmpty < 3 && page <= args.maxPagesPerCategory) {
        if (args.maxProducts > 0 && summary.scraped >= args.maxProducts) break;

        let rawProducts = [];
        try {
          rawProducts = await fetchProductsPage(category, page);
        } catch (error) {
          console.warn(`  Page ${page}: ${error.message}`);
          summary.page_errors += 1;
          consecutiveEmpty += 1;
          page += 1;
          await sleep(args.delay);
          continue;
        }

        if (rawProducts.length === 0) {
          consecutiveEmpty += 1;
          console.log(`  Page ${page}: no products`);
          page += 1;
          await sleep(args.delay);
          continue;
        }

        consecutiveEmpty = 0;
        for (const rawProduct of rawProducts) {
          if (args.maxProducts > 0 && summary.scraped >= args.maxProducts) break;
          const product = transformProduct(rawProduct, category);
          if (!product) continue;
          batch.push(product);
          summary.scraped += 1;
          if (batch.length >= args.batchSize) {
            await flushBatch();
            await sleep(args.delay);
          }
        }

        console.log(`  Page ${page}: total scraped=${summary.scraped}`);
        if (rawProducts.length < PAGE_SIZE) break;
        page += 1;
        await sleep(args.delay);
      }
    }

    await flushBatch();
    if (args.failOnEmpty && summary.scraped === 0) {
      throw new Error(`No products scraped; page_errors=${summary.page_errors}`);
    }
    console.log(`\nComplete: ${JSON.stringify(summary)}`);
    return summary;
  } finally {
    await sink.close();
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

try {
  const args = parseArgs(process.argv.slice(2));
  await run(args);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
