import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';

const DOMAIN = 'linensalvageluxe.com';
const SOURCE = 'shopify';
const MERCHANT_ID = 'linensalvageluxe.com';
const COUNTRY_CODE = 'US';
const REGION = 'global';
const DB_URL = process.env.DATABASE_URL || 'postgresql://ingest_rw:Ingestmsk0qq1h@sakura.proxy.rlwy.net:22987/railway';
const TODAY = new Date().toISOString().slice(0, 10);

function stableProductId(source, sku, countryCode) {
  const hash = crypto.createHash('sha256').update(`${source}:${sku}:${countryCode}`).digest('hex');
  return BigInt(`0x${hash.slice(0, 15)}`).toString();
}

async function fetchAllProducts() {
  const products = [];
  let page = 1;
  while (true) {
    const url = `https://${DOMAIN}/products.json?limit=250&page=${page}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const batch = data.products || [];
    if (batch.length === 0) break;
    products.push(...batch);
    if (batch.length < 250) break;
    page++;
    await new Promise(r => setTimeout(r, 500));
  }
  return products;
}

function transformProduct(product) {
  const variant = product.variants?.[0] || {};
  const price = parseFloat(variant.price) || 0;
  const imageUrl = product.images?.[0]?.src || null;
  const sku = `shopify-${DOMAIN}-${product.id}`;
  return {
    id: stableProductId(SOURCE, sku, COUNTRY_CODE),
    sku,
    title: product.title || 'Untitled',
    description: product.body_html || null,
    price,
    currency: 'USD',
    url: product.handle ? `https://${DOMAIN}/products/${product.handle}` : `https://${DOMAIN}/`,
    category: product.product_type || 'Linens',
    image_url: imageUrl,
    brand: product.vendor || '',
    in_stock: variant.available ?? true,
    metadata: {
      shopify_id: product.id,
      vendor: product.vendor,
      tags: product.tags || [],
      variants_count: product.variants?.length || 0,
      images_count: product.images?.length || 0,
      created_at: product.created_at,
      updated_at: product.updated_at,
      original_price: variant.compare_at_price ? parseFloat(variant.compare_at_price) : null,
    },
  };
}

async function main() {
  console.log(`[BUY-75885] Fetching products from ${DOMAIN}...`);
  const raw = await fetchAllProducts();
  console.log(`[BUY-75885] Fetched ${raw.length} products`);

  const transformed = raw.map(transformProduct);

  // Write JSONL
  const jsonlDir = path.join('/paperclip/instances/default/workspaces/7fb55262-e658-45e2-88c0-b0e8ccc5ad6c', 'data');
  fs.mkdirSync(jsonlDir, { recursive: true });
  const jsonlPath = path.join(jsonlDir, `shopify_linensalvageluxe_com_${TODAY}.jsonl`);
  const lines = transformed.map(p => JSON.stringify(p)).join('\n') + '\n';
  fs.writeFileSync(jsonlPath, lines);
  console.log(`[BUY-75885] Wrote ${transformed.length} records to ${jsonlPath}`);

  // Insert into DB
  const pool = new pg.Pool({ connectionString: DB_URL, connectionTimeoutMillis: 15000 });
  const client = await pool.connect();
  try {
    // Upsert merchant
    await client.query(
      `INSERT INTO merchants (id, name, source, country, domain, onboarding_stage, is_active, created_at, updated_at, last_scraped_at)
       VALUES ($1, $2, $3, $4, $5, 'indexed', true, NOW(), NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET updated_at=NOW(), last_scraped_at=NOW(), onboarding_stage='indexed'`,
      [MERCHANT_ID, 'Linen Salvage Luxe', SOURCE, COUNTRY_CODE, DOMAIN]
    );
    console.log(`[BUY-75885] Merchant upserted`);

    // Batch insert products using ON CONFLICT DO NOTHING
    const BATCH = 100;
    let written = 0;
    for (let i = 0; i < transformed.length; i += BATCH) {
      const batch = transformed.slice(i, i + BATCH);
      const vals = [];
      const phs = [];
      let pi = 1;
      for (const p of batch) {
        phs.push(`($${pi},$${pi+1},$${pi+2},$${pi+3},$${pi+4},$${pi+5},$${pi+6},$${pi+7},$${pi+8},$${pi+9},$${pi+10},$${pi+11},$${pi+12}::jsonb,$${pi+13},true,true,NOW(),NOW())`);
        vals.push(p.id, p.sku, SOURCE, MERCHANT_ID, p.title, p.description, p.price, 'USD', p.url, p.category, p.image_url, p.brand, JSON.stringify(p.metadata), COUNTRY_CODE);
        pi += 14;
      }
      const sql = `INSERT INTO products (id,sku,source,merchant_id,title,description,price,currency,url,category,image_url,brand,metadata,country_code,is_active,in_stock,created_at,updated_at) VALUES ${phs.join(', ')} ON CONFLICT DO NOTHING`;
      const res = await client.query(sql, vals);
      written += res.rowCount || 0;
    }
    console.log(`[BUY-75885] Products written to DB: ${written}`);
  } finally {
    client.release();
    await pool.end();
  }

  console.log(`[BUY-75885] DONE — ${transformed.length} products from ${DOMAIN}`);
  console.log(`JSONL: ${jsonlPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
