#!/usr/bin/env node
// BUY-70113: production probe for MCP find_similar vector identifier coverage.
//
// This is intentionally read-only. It samples catalog products that have a
// matching row in either canonical product_embeddings(product_id) or legacy
// search_proof.product_vectors(sku), then calls the production MCP tool by
// public products.id. Exit 0 means at least one probe returned results and no
// probe returned NOT_FOUND for a covered vector row.

import https from 'node:https';
import { Pool } from 'pg';

const catalogUrl = process.env.CATALOG_DATABASE_URL;
const vectorUrl = process.env.VECTOR_DB_URL;
const mcpUrl = process.env.MCP_URL || 'https://api.buywhere.ai/mcp';
const apiKey = process.env.BUYWHERE_MCP_API_KEY || process.env.BUYWHERE_API_KEY;
const sampleLimit = Math.max(1, Math.min(Number(process.env.FIND_SIMILAR_PROBE_LIMIT || 5), 20));

if (!catalogUrl || !vectorUrl || !apiKey) {
  console.error('missing required env: CATALOG_DATABASE_URL, VECTOR_DB_URL, BUYWHERE_MCP_API_KEY/BUYWHERE_API_KEY');
  process.exit(2);
}

const catalog = new Pool({ connectionString: catalogUrl, max: 2, connectionTimeoutMillis: 5000 });
const vector = new Pool({ connectionString: vectorUrl, max: 2, connectionTimeoutMillis: 5000 });

function rpc(productId) {
  return new Promise((resolve, reject) => {
    const url = new URL(mcpUrl);
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: `find-similar-probe-${productId}`,
      method: 'tools/call',
      params: { name: 'find_similar', arguments: { product_id: String(productId), limit: 3 } },
    });
    const req = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname || '/mcp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const samples = [];

  try {
    const canonical = await vector.query(
      `SELECT product_id::text AS product_id, 'product_embeddings' AS source
         FROM product_embeddings
        ORDER BY product_id DESC
        LIMIT $1`,
      [sampleLimit]
    );
    samples.push(...canonical.rows);
  } catch (err) {
    console.warn(`canonical vector sample skipped: ${err.message}`);
  }

  if (samples.length < sampleLimit) {
    try {
      const legacy = await vector.query(
        `SELECT sku, 'search_proof.product_vectors' AS source
           FROM search_proof.product_vectors
          WHERE sku IS NOT NULL
          LIMIT $1`,
        [sampleLimit - samples.length]
      );
      if (legacy.rows.length) {
        const skus = legacy.rows.map(r => r.sku);
        const mapped = await catalog.query(
          `SELECT DISTINCT ON (sku) id::text AS product_id, sku, 'search_proof.product_vectors' AS source
             FROM products
            WHERE sku = ANY($1::text[]) AND is_active = true
            ORDER BY sku, updated_at DESC`,
          [skus]
        );
        samples.push(...mapped.rows);
      }
    } catch (err) {
      console.warn(`legacy vector sample skipped: ${err.message}`);
    }
  }

  const uniqueSamples = Array.from(new Map(samples.map(s => [s.product_id, s])).values()).slice(0, sampleLimit);
  if (!uniqueSamples.length) throw new Error('no vector-covered catalog samples found');

  let ok = 0;
  const failures = [];
  for (const sample of uniqueSamples) {
    const res = await rpc(sample.product_id);
    const errorCode = res.body?.error?.data?.envelope?.error?.code || res.body?.error?.code || null;
    let total = null;
    if (!res.body?.error) {
      const text = res.body?.result?.content?.[0]?.text;
      const parsed = typeof text === 'string' ? JSON.parse(text) : res.body?.result;
      total = parsed?.total ?? parsed?.similar?.length ?? null;
      if (Number(total) > 0) ok++;
    }
    const line = { product_id: sample.product_id, sku: sample.sku || null, source: sample.source, status: res.status, errorCode, total };
    console.log(JSON.stringify(line));
    if (errorCode === 'NOT_FOUND' || errorCode === -32001 || !(Number(total) > 0)) failures.push(line);
  }

  if (ok === 0 || failures.length) {
    throw new Error(`find_similar coverage failed: ok=${ok}, failures=${failures.length}`);
  }
}

main()
  .finally(async () => { await catalog.end().catch(() => {}); await vector.end().catch(() => {}); })
  .catch((err) => { console.error(err.message); process.exit(1); });
