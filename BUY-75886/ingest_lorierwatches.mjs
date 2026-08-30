import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
const require = createRequire('/home/paperclip/buywhere/package.json');
const pg = require('pg');

const ISSUE = 'BUY-75886';
const DOMAIN = 'lorierwatches.com';
const BASE_URL = `https://${DOMAIN}`;
const MERCHANT_ID = 'lorierwatches.com';
const MERCHANT_NAME = 'Lorier';
const SOURCE = 'shopify';
const COUNTRY_CODE = 'US';
const REGION = 'us';
const CURRENCY = 'USD';
const CATEGORY = 'Watches';
const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const outputPath = `/home/paperclip/buywhere/data/lorierwatches_${today}.ndjson`;
const dbUrl = fs.readFileSync('/home/paperclip/buywhere/data/.catalog_db_url', 'utf8').trim();
if (/roundhouse/i.test(dbUrl)) throw new Error('Refusing control-plane DSN');

function stableId(source, sku, countryCode) {
  const digest = crypto.createHash('sha256').update(`${source}:${sku}:${countryCode}`).digest('hex');
  return BigInt(`0x${digest.slice(0, 15)}`).toString();
}

function stripHtml(value) {
  return String(value || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json,text/plain,*/*',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 BuyWhereBot/1.0'
    }
  });
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
  return response.json();
}

async function fetchAllProducts() {
  const raw = [];
  for (let page = 1; page <= 20; page += 1) {
    const data = await fetchJson(`${BASE_URL}/products.json?limit=250&page=${page}`);
    const products = Array.isArray(data.products) ? data.products : [];
    if (products.length === 0) break;
    raw.push(...products);
    if (products.length < 250) break;
    await sleep(750);
  }
  return raw;
}

function parsePrice(value) {
  const price = Number.parseFloat(value);
  return Number.isFinite(price) ? price : 0;
}

function normalizeProduct(product) {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const firstVariant = variants[0] || {};
  const images = Array.isArray(product.images) ? product.images : [];
  const handle = product.handle || String(product.id || 'unknown');
  const sku = `${DOMAIN}:${product.id}`;
  const tags = Array.isArray(product.tags) ? product.tags : String(product.tags || '').split(',').map(tag => tag.trim()).filter(Boolean);
  const inStock = variants.length ? variants.some(variant => variant.available !== false) : true;
  const compareAt = firstVariant.compare_at_price ? parsePrice(firstVariant.compare_at_price) : null;
  return {
    id: stableId(SOURCE, sku, COUNTRY_CODE),
    sku,
    source: SOURCE,
    merchant_id: MERCHANT_ID,
    title: product.title || handle,
    description: stripHtml(product.body_html).slice(0, 5000) || null,
    price: parsePrice(firstVariant.price),
    currency: CURRENCY,
    url: `${BASE_URL}/products/${handle}`,
    category: product.product_type || CATEGORY,
    category_path: [CATEGORY, product.product_type || CATEGORY].filter((value, index, arr) => value && arr.indexOf(value) === index),
    image_url: images[0]?.src || null,
    brand: product.vendor || MERCHANT_NAME,
    is_active: true,
    is_available: inStock,
    in_stock: inStock,
    stock_level: inStock ? 'in_stock' : 'out_of_stock',
    region: REGION,
    country_code: COUNTRY_CODE,
    platform: 'shopify',
    scraped_via: ISSUE,
    metadata: {
      domain: DOMAIN,
      canonical_id: product.id,
      shopify_product_id: product.id,
      shopify_variant_id: firstVariant.id || null,
      handle,
      vendor: product.vendor || null,
      tags,
      variants_count: variants.length,
      images_count: images.length,
      compare_at_price: compareAt,
      created_at: product.created_at || null,
      updated_at: product.updated_at || null,
      scraped_issue: ISSUE,
      discovery_rotation: 'r416',
      discovery_batch: 'batch201'
    }
  };
}

async function upsertProducts(rows) {
  const pool = new pg.Pool({ connectionString: dbUrl, application_name: 'dash-buy-75886-lorierwatches', connectionTimeoutMillis: 15000 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO merchants (id, name, source, country, domain, onboarding_stage, is_active, created_at, updated_at, last_scraped_at)
       VALUES ($1, $2, $3, $4, $5, 'indexed', true, NOW(), NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, source = EXCLUDED.source, country = EXCLUDED.country, domain = EXCLUDED.domain, onboarding_stage = 'indexed', is_active = true, updated_at = NOW(), last_scraped_at = NOW()`,
      [MERCHANT_ID, MERCHANT_NAME, SOURCE, COUNTRY_CODE, DOMAIN]
    );

    let affected = 0;
    const batchSize = 50;
    for (let offset = 0; offset < rows.length; offset += batchSize) {
      const batch = rows.slice(offset, offset + batchSize);
      const values = [];
      const placeholders = [];
      let index = 1;
      for (const row of batch) {
        placeholders.push(`($${index},$${index + 1},$${index + 2},$${index + 3},$${index + 4},$${index + 5},$${index + 6},$${index + 7},$${index + 8},$${index + 9},$${index + 10},$${index + 11},$${index + 12}::text[],$${index + 13}::jsonb,$${index + 14},$${index + 15},$${index + 16},$${index + 17},$${index + 18},NOW(),NOW(),NOW(),'ok')`);
        values.push(row.id, row.sku, row.source, row.merchant_id, row.title, row.description, row.price, row.currency, row.url, row.category, row.image_url, row.brand, row.category_path, JSON.stringify(row.metadata), row.country_code, row.region, row.in_stock, row.is_available, row.platform);
        index += 19;
      }
      const result = await client.query(
        `INSERT INTO products (id, sku, source, merchant_id, title, description, price, currency, url, category, image_url, brand, category_path, metadata, country_code, region, in_stock, is_available, platform, created_at, updated_at, url_last_checked_at, url_status)
         VALUES ${placeholders.join(',')}
         ON CONFLICT (sku, source) DO UPDATE SET
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           price = EXCLUDED.price,
           currency = EXCLUDED.currency,
           url = EXCLUDED.url,
           category = EXCLUDED.category,
           image_url = EXCLUDED.image_url,
           brand = EXCLUDED.brand,
           category_path = EXCLUDED.category_path,
           metadata = EXCLUDED.metadata,
           country_code = EXCLUDED.country_code,
           region = EXCLUDED.region,
           in_stock = EXCLUDED.in_stock,
           is_available = EXCLUDED.is_available,
           platform = EXCLUDED.platform,
           is_active = true,
           updated_at = NOW(),
           data_updated_at = NOW(),
           url_last_checked_at = NOW(),
           url_status = 'ok'`,
        values
      );
      affected += result.rowCount;
    }
    const countResult = await client.query('SELECT COUNT(*)::int AS count FROM products WHERE merchant_id = $1 AND source = $2', [MERCHANT_ID, SOURCE]);
    await client.query('COMMIT');
    return { affected, dbCount: countResult.rows[0].count };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

const rawProducts = await fetchAllProducts();
if (rawProducts.length === 0) throw new Error('No products returned from Shopify products.json');
const rows = rawProducts.map(normalizeProduct).filter(row => row.title && row.price >= 0);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
const { affected, dbCount } = await upsertProducts(rows);
console.log(JSON.stringify({ issue: ISSUE, domain: DOMAIN, fetched: rawProducts.length, written: rows.length, affected, dbCount, outputPath }));
