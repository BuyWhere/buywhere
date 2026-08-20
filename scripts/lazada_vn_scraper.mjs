#!/usr/bin/env node
/**
 * scripts/lazada_vn_scraper.mjs — BUY-40828 Lazada Vietnam scraper
 *
 * Scrapes product listings from lazada.vn across multiple categories
 * and writes NDJSON to data/affiliate_ndjson/lazada_vn.ndjson.
 *
 * Proxy chain (same as lazada_th_scraper.mjs):
 *   1. ScraperAPI ultra_premium + render=true  (SCRAPERAPI_KEY)
 *   2. BrightData residential    (BRIGHTDATA_RESIDENTIAL_*)
 *   3. BrightData datacenter     (BRIGHTDATA_DATACENTER_*)
 *   4. Direct fallback
 *
 * Usage:
 *   node scripts/lazada_vn_scraper.mjs --scrape-only
 *   node scripts/lazada_vn_scraper.mjs --api-key <key> [--api-base http://localhost:8000]
 */

import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const MERCHANT_ID = 'lazada_vn';
const SOURCE = 'lazada_vn';
const BASE_URL = 'https://www.lazada.vn';
const DEFAULT_OUTPUT = 'data/affiliate_ndjson/lazada_vn.ndjson';
const PAGE_SIZE = 40;

// ---------------------------------------------------------------------------
// Proxy resolution
// ---------------------------------------------------------------------------

function resolveProxyConfig() {
  // 1. ScraperAPI with render=true for JavaScript-heavy Lazada pages.
  //    Use ultra_premium for the strongest anti-bot bypass (default on).
  const saKey = String(process.env.SCRAPERAPI_KEY || '').trim();
  if (saKey) {
    const params = new URLSearchParams({
      url: 'INJECT_TARGET_URL',
      country_code: 'vn',
      api_key: saKey,
      render: 'true',
    });
    const ultra = String(process.env.SCRAPERAPI_ULTRA || 'true').toLowerCase() !== 'false';
    if (ultra) params.set('ultra_premium', 'true');
    return { url: `https://api.scraperapi.com/?${params.toString()}`, kind: 'scraperapi', ultra };
  }

  // 2. BrightData residential (full ASN diversity, best for anti-bot)
  const bdResHost = String(process.env.BRIGHTDATA_RESIDENTIAL_HOST || '').trim();
  const bdResUser = String(process.env.BRIGHTDATA_RESIDENTIAL_USERNAME || '').trim();
  const bdResPass = String(process.env.BRIGHTDATA_RESIDENTIAL_PASSWORD || '').trim();
  const bdResPort = String(process.env.BRIGHTDATA_RESIDENTIAL_PORT || '22225').trim();
  if (bdResHost && bdResUser && bdResPass) {
    return {
      url: `http://${bdResUser}:${bdResPass}@${bdResHost}:${bdResPort}`,
      kind: 'brightdata_residential',
    };
  }

  // 3. BrightData datacenter
  const bdDcHost = String(process.env.BRIGHTDATA_DATACENTER_HOST || '').trim();
  const bdDcUser = String(process.env.BRIGHTDATA_DATACENTER_USERNAME || '').trim();
  const bdDcPass = String(process.env.BRIGHTDATA_ZONE_PASSWORD || '').trim();
  const bdDcPort = String(process.env.BRIGHTDATA_DATACENTER_PORT || '2222').trim();
  if (bdDcHost && bdDcUser && bdDcPass) {
    return {
      url: `http://${bdDcUser}:${bdDcPass}@${bdDcHost}:${bdDcPort}`,
      kind: 'brightdata_datacenter',
    };
  }

  return { url: '', kind: 'direct' };
}

const PROXY = resolveProxyConfig();

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  DNT: '1',
  Connection: 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
};

// ---------------------------------------------------------------------------
// Proxy URL resolution
// ---------------------------------------------------------------------------

function buildProxyUrl(targetUrl) {
  if (PROXY.kind === 'scraperapi') {
    return PROXY.url.replace('INJECT_TARGET_URL', encodeURIComponent(targetUrl));
  }
  return targetUrl;
}

function detectProxyError(response, text) {
  if (PROXY.kind !== 'scraperapi') return null;
  if (response.status === 403 && text.includes('ultra_premium')) {
    return 'ScraperAPI requires ultra_premium=true for this domain.';
  }
  if (text.includes('credits') || text.includes('api_key') || text.includes('not authorized')) {
    return `ScraperAPI error: ${text.slice(0, 200)}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// BrightData CONNECT proxy via undici
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

async function fetchWithRetry(rawUrl, retries = 3) {
  const resolvedUrl = buildProxyUrl(rawUrl);
  let lastError;
  let lastText = '';

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const fetchFn =
        PROXY.kind === 'brightdata_residential' || PROXY.kind === 'brightdata_datacenter'
          ? await getUndiciFetch()
          : (u, o) => fetch(u, { ...o });

      const response = await fetchFn(resolvedUrl, {
        headers: HEADERS,
        signal: AbortSignal.timeout(30_000),
      });
      lastText = await response.text();

      const proxyError = detectProxyError(response, lastText);
      if (proxyError) throw new Error(proxyError);

      if (!response.ok && response.status !== 200) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      return { text: lastText, status: response.status };
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
// HTML parsing helpers (mirrors lazada_th_scraper.mjs)
// ---------------------------------------------------------------------------

function extractProductsFromHtml(html) {
  const products = [];

  // Lazada embeds product data in several JSON blobs in the page HTML.

  // 1. window.DS.conf = { data: { products: [...] } }
  const dsMatch = html.match(/window\.DS\.conf\s*=\s*(\{[\s\S]*?\});/);
  if (dsMatch) {
    try {
      const data = JSON.parse(dsMatch[1]);
      const items = data?.data?.products || [];
      for (const item of items) {
        const p = normalizeLazadaProduct(item);
        if (p) products.push(p);
      }
    } catch {
      // malformed JSON, fall through
    }
  }

  // 2. window.__INITIAL_STATE__ = { products: { products: [...] } }
  if (products.length === 0) {
    const initMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/);
    if (initMatch) {
      try {
        const data = JSON.parse(initMatch[1]);
        const items = data?.products?.products || data?.data?.products || [];
        for (const item of items) {
          const p = normalizeLazadaProduct(item);
          if (p) products.push(p);
        }
      } catch {
        // malformed JSON, fall through
      }
    }
  }

  // 3. Generic "products": [ ... ] JSON array
  if (products.length === 0) {
    const prodMatch = html.match(/"products":\s*(\[[\s\S]*?\])/);
    if (prodMatch) {
      try {
        const items = JSON.parse(prodMatch[1]);
        for (const item of items) {
          const p = normalizeLazadaProduct(item);
          if (p) products.push(p);
        }
      } catch {
        // malformed JSON, fall through
      }
    }
  }

  // 4. JSON-LD ItemList
  if (products.length === 0) {
    const ldPattern = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
    let ldMatch;
    while ((ldMatch = ldPattern.exec(html)) !== null) {
      try {
        const ld = JSON.parse(ldMatch[1]);
        const itemList = Array.isArray(ld) ? ld : [ld];
        for (const entry of itemList) {
          const elements = entry?.itemListElement || (entry['@type'] === 'ItemList' ? entry.itemListElement : []);
          if (!Array.isArray(elements)) continue;
          for (const el of elements) {
            const item = el.item || el;
            if (item && (item['@type'] === 'Product' || item.name)) {
              const p = normalizeLazadaProduct(item);
              if (p) products.push(p);
            }
          }
        }
      } catch {
        // malformed JSON-LD, skip
      }
    }
  }

  // 5. Fallback: parse individual product cards from HTML attributes
  if (products.length === 0) {
    const cardPattern = /data-sqe="item"\s+data-product='(\{[^']+\})'/g;
    let match;
    while ((match = cardPattern.exec(html)) !== null) {
      try {
        const item = JSON.parse(match[1]);
        const p = normalizeLazadaProduct(item);
        if (p) products.push(p);
      } catch {
        // malformed card JSON, skip
      }
    }
  }

  return products;
}

// ---------------------------------------------------------------------------
// Product normalization (mirrors lazada_th_scraper.mjs)
// ---------------------------------------------------------------------------

function looksLikeGtin(value) {
  const normalized = String(value || '').replace(/[\s-]/g, '');
  return /^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(normalized);
}

function normalizeLazadaProduct(raw) {
  const p = raw || {};

  const productId = String(
    p.productId || p.itemId || p.product_id || p.item_id || '',
  );
  const shopId = String(p.shopId || p.shop_id || '');
  const sku = productId ? `LAZVN_${productId}` : '';

  const name =
    p.name ||
    p.productTitle ||
    p.title ||
    p.pdt_title ||
    p.headline ||
    '';

  if (!productId || !name) return null;

  // Price: Lazada stores prices as floats or (sometimes) as integers × 100000.
  let price = parseFloat(p.price || p.salePrice || p.priceShow || 0);
  if (price > 100_000) price = price / 100_000;

  let originalPrice = parseFloat(
    p.originalPrice || p.priceBeforeDiscount || p.highPrice || price,
  );
  if (originalPrice > 100_000) originalPrice = originalPrice / 100_000;
  if (!Number.isFinite(originalPrice)) originalPrice = price;

  // Discount
  let discount = 0;
  const rawDiscount = p.discount || p.discount_rate || 0;
  if (rawDiscount) {
    const m = String(rawDiscount).match(/(\d+)/);
    discount = m ? parseInt(m[1], 10) : 0;
  }

  // Image URL
  let imageUrl = '';
  if (Array.isArray(p.images) && p.images.length > 0) {
    imageUrl = typeof p.images[0] === 'string' ? p.images[0] : '';
  } else if (p.image) {
    imageUrl = p.image;
  } else if (p.thumb) {
    imageUrl = p.thumb;
  } else if (p.picture) {
    imageUrl = p.picture;
  } else if (p.productImage) {
    imageUrl = p.productImage;
  }
  if (imageUrl.startsWith('//')) imageUrl = `https:${imageUrl}`;

  // Product URL
  let productUrl = p.productUrl || p.url || p.product_url || '';
  if (productUrl && !productUrl.startsWith('http')) {
    productUrl = BASE_URL + productUrl;
  }
  if (!productUrl && productId) {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60);
    productUrl = `https://www.lazada.vn/products/${slug}-i${productId}-s${shopId}.html`;
  }

  // Brand
  const brand =
    p.brand ||
    p.brandName ||
    p.productBrand ||
    p.manufacturer ||
    '';

  // Rating & reviews
  const rating = parseFloat(p.rating || p.ratingScore || p.starRating || 0);
  const reviewCount = parseInt(
    p.review || p.reviewCount || p.ratingCount || p.totalReview || 0,
    10,
  );

  // Seller
  let sellerName = '';
  const seller = p.seller || p.sellerInfo || {};
  if (typeof seller === 'object' && seller) {
    sellerName = seller.name || seller.shopName || seller.sellerName || '';
  }

  // Location
  const location = p.location || '';

  // Sold count
  const soldCount = parseInt(p.soldCount || p.sold || 0, 10);

  // GTIN
  const gtinRaw = p.gtin13 || p.gtin12 || p.gtin || p.naturalSearchID || '';
  const gtin = looksLikeGtin(gtinRaw) ? String(gtinRaw) : '';

  // MPN
  const mpn = p.mpn || '';

  return {
    sku,
    gtin,
    mpn,
    merchant_id: MERCHANT_ID,
    title: String(name).slice(0, 500),
    description: String(p.description || p.productDescription || '').slice(0, 2000),
    price: Number.isFinite(price) ? price : 0,
    currency: 'VND',
    url: productUrl,
    image_url: imageUrl,
    category: '',
    category_path: [],
    brand: String(brand).slice(0, 200),
    is_active: true,
    metadata: {
      original_price: Number.isFinite(originalPrice) ? originalPrice : price,
      discount_pct: discount,
      rating,
      review_count: reviewCount,
      location,
      sold_count: soldCount,
      product_id: productId,
      shop_id: shopId,
      seller_name: sellerName,
      lazada_category_id: p.categoryId || '',
      country_code: 'VN',
      region: 'VN',
      source: SOURCE,
    },
  };
}

// ---------------------------------------------------------------------------
// Lazada VN categories
// ---------------------------------------------------------------------------

const CATEGORIES = [
  // Electronics
  { id: 'electronics-phones', name: 'Electronics', sub: 'Phones', catid: '27716', keyword: 'dien thoai smartphone' },
  { id: 'electronics-laptops', name: 'Electronics', sub: 'Laptops', catid: '27717', keyword: 'laptop may tinh xach tay' },
  { id: 'electronics-tablets', name: 'Electronics', sub: 'Tablets', catid: '27718', keyword: 'may tinh bang tablet' },
  { id: 'electronics-audio', name: 'Electronics', sub: 'Audio', catid: '26250', keyword: 'tai nghe loa' },
  { id: 'electronics-accessories', name: 'Electronics', sub: 'Accessories', catid: '26249', keyword: 'phu kien dien thoai sac du phong' },
  // Home & Living
  { id: 'home-kitchen', name: 'Home & Living', sub: 'Kitchen', catid: '18869', keyword: 'noi com dien bep dien' },
  { id: 'home-cleaning', name: 'Home & Living', sub: 'Cleaning', catid: '22544', keyword: 'may hut bui robot hut bui' },
  { id: 'home-decor', name: 'Home & Living', sub: 'Home Decor', catid: '18787', keyword: 'rem giuong ga goi decor' },
  // Fashion
  { id: 'fashion-women', name: 'Fashion', sub: "Women's Fashion", catid: '19693', keyword: 'aodam nu vay nu' },
  { id: 'fashion-men', name: 'Fashion', sub: "Men's Fashion", catid: '19694', keyword: 'ao nam quan nam' },
  { id: 'fashion-bags', name: 'Fashion', sub: 'Bags & Luggage', catid: '18384', keyword: 'tui xach balo vali' },
  { id: 'fashion-watches', name: 'Fashion', sub: 'Watches & Jewelry', catid: '19118', keyword: 'dong ho trang suc' },
  // Health & Beauty
  { id: 'health-skincare', name: 'Health & Beauty', sub: 'Skincare', catid: '25439', keyword: 'kem duong son môi' },
  { id: 'health-makeup', name: 'Health & Beauty', sub: 'Makeup', catid: '21822', keyword: 'son mong mi phan' },
  { id: 'health-supplements', name: 'Health & Beauty', sub: 'Health Supplements', catid: '18607', keyword: 'vitamin thuc pham chuc nang' },
  { id: 'health-personal', name: 'Health & Beauty', sub: 'Personal Care', catid: '21535', keyword: 'sua tam sua chải rang' },
  // Sports & Outdoors
  { id: 'sports-fitness', name: 'Sports & Outdoors', sub: 'Fitness', catid: '23040', keyword: 'tap gym yoga mat' },
  { id: 'sports-outdoor', name: 'Sports & Outdoors', sub: 'Outdoor', catid: '23045', keyword: 'leu dao camping' },
  // Groceries
  { id: 'grocery-snacks', name: 'Groceries', sub: 'Snacks & Food', catid: '18044', keyword: 'an vat snack thuc an' },
];

// ---------------------------------------------------------------------------
// Page fetching
// ---------------------------------------------------------------------------

async function fetchSearchPage(category, page) {
  const offset = (page - 1) * PAGE_SIZE;
  const keyword = encodeURIComponent(category.keyword);

  // Lazada's catalog page renders product data via JS; ScraperAPI render=true
  // is required for the script-friendly form.
  const searchUrl = `${BASE_URL}/catalog/?q=${keyword}&sort=total_orders&page=${page}&from=${offset}`;

  const { text } = await fetchWithRetry(searchUrl);
  const rawProducts = extractProductsFromHtml(text);

  // Attach category metadata
  return rawProducts.map((p) => ({
    ...p,
    category: category.name,
    category_path: [category.name, category.sub],
  }));
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    apiBase: 'http://localhost:8000',
    apiKey: process.env.BUYWHERE_API_KEY || '',
    batchSize: 100,
    delay: 2000,
    scrapeOnly: false,
    output: DEFAULT_OUTPUT,
    maxProducts: 0,
    maxPagesPerCategory: 5000,
    categories: [],
    failOnEmpty: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
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
  console.log(`Lazada VN scraper — BUY-40828

Usage:
  node scripts/lazada_vn_scraper.mjs --scrape-only
  node scripts/lazada_vn_scraper.mjs --api-key <key> [--api-base http://localhost:8000]

Options:
  --scrape-only                 Write NDJSON without ingesting
  --output <path>               NDJSON path (default: ${DEFAULT_OUTPUT})
  --api-key <key>               BuyWhere API key
  --api-base <url>              BuyWhere API base URL
  --batch-size <n>              Write/ingest batch size (default: 100)
  --delay <ms>                  Delay between requests/batches (default: 2000)
  --max-products <n>            Stop after n transformed products; 0 means unlimited
  --max-pages-per-category <n>  Page cap per category (default: 5000)
  --category <id>               Restrict to category id; repeatable
  --fail-on-empty               Exit non-zero if no products are scraped

Proxy chain (auto-detected):
  1. ScraperAPI ultra_premium + render=true  (SCRAPERAPI_KEY)
  2. BrightData residential    (BRIGHTDATA_RESIDENTIAL_*)
  3. BrightData datacenter     (BRIGHTDATA_DATACENTER_*)
  4. Direct fallback
`);
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

    const response = await fetch(
      `${this.args.apiBase.replace(/\/$/, '')}/v1/ingest/products`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.args.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ source: SOURCE, products }),
      },
    );

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
    ? CATEGORIES.filter((c) => categoryFilter.has(c.id))
    : CATEGORIES;

  if (categories.length === 0) {
    throw new Error(`No categories matched: ${Array.from(categoryFilter).join(', ')}`);
  }

  const sink = new ProductSink(args);
  sink.open();

  const summary = {
    scraped: 0,
    inserted: 0,
    updated: 0,
    failed: 0,
    page_errors: 0,
    output: sink.outputPath,
  };
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
    console.log('Lazada VN scraper starting — BUY-40828');
    console.log(`Mode: ${args.scrapeOnly ? 'scrape-only NDJSON' : `ingest ${args.apiBase}`}`);
    console.log(`Proxy: ${PROXY.kind}${PROXY.kind === 'scraperapi' ? (PROXY.ultra ? ' (ultra_premium + render=true)' : ' (render=true)') : ''}`);
    console.log(`Output: ${sink.outputPath}`);
    console.log(`Categories: ${categories.length}; target: ${args.maxProducts || 'unlimited'} products\n`);

    for (const category of categories) {
      let page = 1;
      let consecutiveEmpty = 0;
      console.log(`[${category.name} / ${category.sub}] Starting...`);

      while (consecutiveEmpty < 3 && page <= args.maxPagesPerCategory) {
        if (args.maxProducts > 0 && summary.scraped >= args.maxProducts) break;

        let products = [];
        try {
          products = await fetchSearchPage(category, page);
        } catch (error) {
          console.warn(`  Page ${page}: ${error.message}`);
          summary.page_errors += 1;
          consecutiveEmpty += 1;
          page += 1;
          await sleep(args.delay);
          continue;
        }

        if (products.length === 0) {
          consecutiveEmpty += 1;
          console.log(`  Page ${page}: no products`);
          page += 1;
          await sleep(args.delay);
          continue;
        }

        consecutiveEmpty = 0;
        for (const product of products) {
          if (args.maxProducts > 0 && summary.scraped >= args.maxProducts) break;
          batch.push(product);
          summary.scraped += 1;
          if (batch.length >= args.batchSize) {
            await flushBatch();
            await sleep(args.delay);
          }
        }

        console.log(`  Page ${page}: scraped=${summary.scraped} (this page: ${products.length})`);
        if (products.length < PAGE_SIZE) break;
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
