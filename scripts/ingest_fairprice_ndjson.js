#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Pool } = require('pg');

const BATCH_SIZE = 500;
const DATA_DIR = process.argv[2] || path.join(__dirname, '..', 'data', 'fairprice_scrape');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function upsertBatch(products) {
  if (!products.length) return { inserted: 0, updated: 0 };

  const values = [];
  const params = [];
  let idx = 1;

  for (const p of products) {
    const barcodes = (p.metadata?.barcodes || []);
    const barcode = barcodes[0] || null;
    values.push(`($${idx}, $${idx+1}, $${idx+2}, $${idx+3}, $${idx+4}, $${idx+5}, $${idx+6}, $${idx+7}, $${idx+8}, $${idx+9}, $${idx+10}, $${idx+11}, $${idx+12}, $${idx+13}, $${idx+14}, $${idx+15})`);
    params.push(
      p.sku,                        // 1
      'fairprice_sg',               // 2 source
      p.merchant_id || 'fairprice_sg', // 3
      p.title,                      // 4
      p.description || '',          // 5
      p.price,                      // 6
      p.currency || 'SGD',          // 7
      p.url,                        // 8
      p.category || '',             // 9
      p.category_path || [],        // 10
      p.image_url || '',            // 11
      p.brand || '',                // 12
      p.is_active !== false,        // 13
      p.in_stock !== false,         // 14
      String(p.stock_level ?? ''),  // 15
      JSON.stringify(p.metadata || {}), // 16
    );
    idx += 16;
  }

  const query = `
    INSERT INTO products (sku, source, merchant_id, title, description, price, currency, url, category, category_path, image_url, brand, is_active, in_stock, stock_level, metadata)
    VALUES ${values.join(', ')}
    ON CONFLICT (sku, source) DO UPDATE SET
      title = EXCLUDED.title,
      price = EXCLUDED.price,
      description = EXCLUDED.description,
      url = EXCLUDED.url,
      category = EXCLUDED.category,
      category_path = EXCLUDED.category_path,
      image_url = EXCLUDED.image_url,
      brand = EXCLUDED.brand,
      is_active = EXCLUDED.is_active,
      in_stock = EXCLUDED.in_stock,
      stock_level = EXCLUDED.stock_level,
      metadata = EXCLUDED.metadata,
      updated_at = NOW()
    RETURNING (xmax = 0) AS is_insert
  `;

  const result = await pool.query(query, params);
  const inserted = result.rows.filter(r => r.is_insert).length;
  const updated = result.rows.filter(r => !r.is_insert).length;
  return { inserted, updated };
}

async function ingestFile(filePath) {
  console.log(`Ingesting: ${filePath}`);
  const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });

  let batch = [];
  let totalInserted = 0;
  let totalUpdated = 0;
  let totalLines = 0;
  let errors = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    totalLines++;

    try {
      batch.push(JSON.parse(line));
    } catch (e) {
      errors++;
      continue;
    }

    if (batch.length >= BATCH_SIZE) {
      try {
        const { inserted, updated } = await upsertBatch(batch);
        totalInserted += inserted;
        totalUpdated += updated;
      } catch (e) {
        console.error(`Batch error at line ${totalLines}: ${e.message}`);
        errors += batch.length;
      }
      batch = [];
      if (totalLines % 5000 === 0) {
        console.log(`  ${totalLines} lines processed, ${totalInserted} inserted, ${totalUpdated} updated`);
      }
    }
  }

  if (batch.length > 0) {
    try {
      const { inserted, updated } = await upsertBatch(batch);
      totalInserted += inserted;
      totalUpdated += updated;
    } catch (e) {
      console.error(`Final batch error: ${e.message}`);
      errors += batch.length;
    }
  }

  console.log(`  Done: ${totalLines} lines, ${totalInserted} inserted, ${totalUpdated} updated, ${errors} errors`);
  return { totalLines, totalInserted, totalUpdated, errors };
}

async function main() {
  const existingCount = await pool.query("SELECT COUNT(*) as c FROM products WHERE source = 'fairprice_sg'");
  console.log(`FairPrice products in DB before ingestion: ${existingCount.rows[0].c}`);

  // Create ingestion run record
  let runId = null;
  try {
    const runResult = await pool.query(
      "INSERT INTO ingestion_runs (source, status) VALUES ('fairprice_sg', 'running') RETURNING id"
    );
    runId = runResult.rows[0]?.id || null;
    if (runId) console.log(`Created ingestion_run id=${runId}`);
  } catch (e) {
    console.warn(`Failed to create ingestion_run record: ${e.message}`);
  }

  let files;
  const stat = fs.statSync(DATA_DIR);
  if (stat.isFile()) {
    files = [DATA_DIR];
  } else {
    files = fs.readdirSync(DATA_DIR)
      .filter(f => f.endsWith('.jsonl'))
      .sort()
      .map(f => path.join(DATA_DIR, f));
  }

  if (!files.length) {
    console.log('No NDJSON files found in', DATA_DIR);
    if (runId) {
      await pool.query(
        "UPDATE ingestion_runs SET status = 'failed', error_message = $1, finished_at = NOW() WHERE id = $2",
        ['No NDJSON files found', runId]
      );
    }
    process.exit(1);
  }

  console.log(`Found ${files.length} NDJSON file(s)`);

  let grandInserted = 0, grandUpdated = 0, grandErrors = 0;

  for (const file of files) {
    const { totalInserted, totalUpdated, errors } = await ingestFile(file);
    grandInserted += totalInserted;
    grandUpdated += totalUpdated;
    grandErrors += errors;
  }

  const finalCount = await pool.query("SELECT COUNT(*) as c FROM products WHERE source = 'fairprice_sg'");
  console.log('\n=== INGESTION COMPLETE ===');
  console.log(`Inserted: ${grandInserted}`);
  console.log(`Updated: ${grandUpdated}`);
  console.log(`Errors: ${grandErrors}`);
  console.log(`FairPrice products in DB after ingestion: ${finalCount.rows[0].c}`);

  // Update ingestion run record with results
  if (runId) {
    const finalStatus = grandErrors > 0 && grandInserted + grandUpdated === 0 ? 'failed' : 'done';
    try {
      await pool.query(
        "UPDATE ingestion_runs SET status = $1, rows_inserted = $2, rows_updated = $3, rows_failed = $4, finished_at = NOW() WHERE id = $5",
        [finalStatus, grandInserted, grandUpdated, grandErrors, runId]
      );
      console.log(`Updated ingestion_run id=${runId} status=${finalStatus}`);
    } catch (e) {
      console.warn(`Failed to update ingestion_run record: ${e.message}`);
    }
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
