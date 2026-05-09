import { Router, Request, Response } from 'express';
import { db, redis } from '../config';
import { requireApiKey } from '../middleware/apiKey';

const router = Router();

const SOURCE_NORMALIZATION: Record<string, string> = {
  'challenger': 'challenger_sg',
  'challenger.sg': 'challenger_sg',
  'challenger_sg': 'challenger_sg',
  'amazon_sg_toys': 'amazon_sg',
  'ikea.com.sg': 'ikea_sg',
};

function normalizeSource(source: string): string {
  return SOURCE_NORMALIZATION[source] || source;
}

interface IngestProductItem {
  sku: string;
  merchant_id: string;
  title: string;
  description?: string;
  price: number;
  currency?: string;
  url: string;
  image_url?: string;
  category?: string;
  category_path?: string[];
  brand?: string;
  is_active?: boolean;
  is_available?: boolean;
  last_checked?: string;
  in_stock?: boolean;
  stock_level?: string;
  availability?: string;
  metadata?: Record<string, unknown>;
  country_code?: string;
  region?: string;
}

interface IngestError {
  index: number;
  sku: string;
  error: string;
  code?: string;
}

function validateProduct(item: unknown, index: number, source: string): { valid: IngestProductItem | null; error: IngestError | null } {
  if (!item || typeof item !== 'object') {
    return {
      valid: null,
      error: { index, sku: 'unknown', error: 'Not an object', code: 'validation_error' },
    };
  }
  const p = item as Record<string, unknown>;

  const sku = typeof p.sku === 'string' ? p.sku : '';
  const err = (msg: string, code: string) => ({ index, sku: sku || 'unknown', error: msg, code });

  if (!sku) return { valid: null, error: err('Missing sku', 'validation_sku_required') };
  if (!p.merchant_id || typeof p.merchant_id !== 'string') return { valid: null, error: err('Missing merchant_id', 'validation_merchant_id_required') };
  if (!p.title || typeof p.title !== 'string') return { valid: null, error: err('Missing title', 'validation_title_required') };
  if (p.price === undefined || p.price === null || typeof p.price !== 'number' || p.price < 0) {
    return { valid: null, error: err('Missing or invalid price (must be >= 0)', 'validation_price_non_positive') };
  }
  if (!p.url || typeof p.url !== 'string') return { valid: null, error: err('Missing url', 'validation_url_invalid') };

  const product: IngestProductItem = {
    sku,
    merchant_id: String(p.merchant_id),
    title: String(p.title).slice(0, 1000),
    price: p.price,
    currency: typeof p.currency === 'string' ? p.currency : 'SGD',
    url: String(p.url),
  };

  if (typeof p.description === 'string') product.description = String(p.description).slice(0, 5000);
  if (typeof p.image_url === 'string') product.image_url = p.image_url;
  if (typeof p.category === 'string') product.category = p.category;
  if (Array.isArray(p.category_path)) product.category_path = p.category_path.map(String).slice(0, 10);
  if (typeof p.brand === 'string') product.brand = String(p.brand).slice(0, 200);
  if (typeof p.is_active === 'boolean') product.is_active = p.is_active;
  if (typeof p.is_available === 'boolean') product.is_available = p.is_available;
  if (typeof p.in_stock === 'boolean') product.in_stock = p.in_stock;
  if (typeof p.stock_level === 'string') product.stock_level = p.stock_level;
  if (typeof p.availability === 'string') product.availability = p.availability;
  if (p.last_checked && typeof p.last_checked === 'string') product.last_checked = p.last_checked;
  if (p.metadata && typeof p.metadata === 'object') product.metadata = p.metadata as Record<string, unknown>;
  if (typeof p.country_code === 'string') product.country_code = p.country_code;
  else if (p.metadata && typeof p.metadata === 'object') {
    const meta = p.metadata as Record<string, unknown>;
    if (typeof meta.country_code === 'string') product.country_code = meta.country_code;
  }
  if (typeof p.region === 'string') product.region = p.region;
  else if (p.metadata && typeof p.metadata === 'object') {
    const meta = p.metadata as Record<string, unknown>;
    if (typeof meta.region === 'string') product.region = meta.region;
  }

  return { valid: product, error: null };
}

function buildCategoryPathLiteral(paths?: string[]): string {
  if (!paths || paths.length === 0) return '{}';
  return `{${paths.map(c => `"${c.replace(/"/g, '\\"')}"`).join(',')}}`;
}

router.get(
  '/health',
  requireApiKey,
  (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  }
);

router.post(
  '/products',
  requireApiKey,
  async (req: Request, res: Response) => {
    const start = Date.now();
    const body = req.body;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({
        run_id: null, status: 'failed', rows_inserted: 0, rows_updated: 0, rows_failed: 0,
        errors: [{ index: 0, sku: 'request', error: 'Body must be an object with source and products', code: 'validation_error' }],
      });
      return;
    }

    const source = normalizeSource(String(body.source || ''));
    if (!source || source === 'undefined') {
      res.status(400).json({
        run_id: null, status: 'failed', rows_inserted: 0, rows_updated: 0, rows_failed: 0,
        errors: [{ index: 0, sku: 'request', error: 'Missing source field', code: 'validation_error' }],
      });
      return;
    }

    if (!Array.isArray(body.products) || body.products.length === 0) {
      res.status(400).json({
        run_id: null, status: 'failed', rows_inserted: 0, rows_updated: 0, rows_failed: 0,
        errors: [{ index: 0, sku: 'request', error: 'products must be a non-empty array', code: 'validation_error' }],
      });
      return;
    }

    if (body.products.length > 1000) {
      res.status(400).json({
        run_id: null, status: 'failed', rows_inserted: 0, rows_updated: 0, rows_failed: 0,
        errors: [{ index: 0, sku: 'request', error: 'Maximum 1000 products per request', code: 'validation_error' }],
      });
      return;
    }

    const validProducts: IngestProductItem[] = [];
    const errors: IngestError[] = [];

    for (let i = 0; i < body.products.length; i++) {
      const { valid, error } = validateProduct(body.products[i], i, source);
      if (valid) validProducts.push(valid);
      if (error) errors.push(error);
    }

    if (validProducts.length === 0) {
      res.status(207).json({
        run_id: null, status: 'failed', rows_inserted: 0, rows_updated: 0,
        rows_failed: errors.length, errors,
      });
      return;
    }

    let runId: number | null = null;
    try {
      const runResult = await db.query(
        `INSERT INTO ingestion_runs (source, status) VALUES ($1, 'running') RETURNING id`,
        [source]
      );
      runId = runResult.rows[0]?.id || null;
    } catch (e) {
      console.warn('[ingest] Failed to create ingestion run record:', (e as Error).message);
    }

    const skus = validProducts.map(p => p.sku);
    const existingResult = await db.query(
      `SELECT sku FROM products WHERE sku = ANY($1::text[]) AND source = $2`,
      [skus, source]
    );
    const existingSkus = new Set(existingResult.rows.map((r: { sku: string }) => r.sku));

    let rowsInserted = 0;
    let rowsUpdated = 0;
    let rowsFailed = errors.length;

    try {
      const values: unknown[] = [];
      const placeholders: string[] = [];

      for (const p of validProducts) {
        const base = values.length + 1;
        const metadata: Record<string, unknown> = {
          ...(p.metadata || {}),
          origin_merchant_id: p.merchant_id,
          availability: p.availability || 'in_stock',
          category: p.category || null,
        };
        if (p.in_stock !== undefined) metadata.in_stock = p.in_stock;
        if (p.stock_level !== undefined) metadata.stock_level = p.stock_level;
        if (p.is_available !== undefined) metadata.is_available = p.is_available;
        if (p.last_checked !== undefined) metadata.last_checked = p.last_checked;

        values.push(
          p.sku, source, p.merchant_id, p.title,
          p.description || null,
          p.price, p.currency || 'SGD',
          p.url, p.image_url || null,
          buildCategoryPathLiteral(p.category_path),
          p.brand || null,
          JSON.stringify(metadata),
          p.is_active !== false,
          p.region || null,
          p.country_code || null,
        );

        placeholders.push(
          `($${base},$${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13},$${base + 14})`
        );
      }

      await db.query(
        `INSERT INTO products
           (sku, source, merchant_id, title, description, price, currency, url,
            image_url, category_path, brand, metadata, is_active, region, country_code)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (sku, source)
         DO UPDATE SET
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           price = EXCLUDED.price,
           currency = EXCLUDED.currency,
           url = EXCLUDED.url,
           image_url = EXCLUDED.image_url,
           brand = EXCLUDED.brand,
           category_path = EXCLUDED.category_path,
           merchant_id = EXCLUDED.merchant_id,
           metadata = EXCLUDED.metadata,
           is_active = true,
           region = COALESCE(EXCLUDED.region, products.region),
           country_code = COALESCE(EXCLUDED.country_code, products.country_code),
           updated_at = NOW()`,
        values
      );

      for (const p of validProducts) {
        if (existingSkus.has(p.sku)) {
          rowsUpdated++;
        } else {
          rowsInserted++;
        }
      }
    } catch (e) {
      const msg = (e as Error).message;
      console.error('[ingest] Bulk upsert failed:', msg);
      rowsFailed += validProducts.length;
      rowsInserted = 0;
      rowsUpdated = 0;
      if (!errors.some(err => err.code === 'database_error')) {
        errors.unshift({ index: -1, sku: 'batch', error: `Database error: ${msg}`, code: 'database_error' });
      }

      if (runId !== null) {
        await db.query(
          `UPDATE ingestion_runs SET status = 'failed', error_message = $1, finished_at = NOW() WHERE id = $2`,
          [msg.slice(0, 500), runId]
        ).catch(() => {});
      }

      res.status(207).json({
        run_id: runId, status: 'failed', rows_inserted: 0, rows_updated: 0,
        rows_failed: rowsFailed, errors,
      });
      return;
    }

    const priceHistoryValues: unknown[] = [];
    const phPlaceholders: string[] = [];

    const finalResult = await db.query(
      `SELECT id, sku FROM products WHERE sku = ANY($1::text[]) AND source = $2`,
      [skus, source]
    );
    const skuToId = new Map(finalResult.rows.map((r: { id: number; sku: string }) => [r.sku, r.id]));

    for (const p of validProducts) {
      const productId = skuToId.get(p.sku);
      if (productId) {
        const base = priceHistoryValues.length + 1;
        priceHistoryValues.push(productId, p.price, p.currency || 'SGD', source);
        phPlaceholders.push(`($${base},$${base + 1},$${base + 2},$${base + 3})`);
      }
    }

    if (priceHistoryValues.length > 0) {
      try {
        await db.query(
          `INSERT INTO price_history (product_id, price, currency, source)
           VALUES ${phPlaceholders.join(', ')}`,
          priceHistoryValues
        );
      } catch (e) {
        console.warn('[ingest] Price history insert failed:', (e as Error).message);
      }
    }

    const status = rowsFailed === 0 ? 'completed' : 'completed_with_errors';
    if (runId !== null) {
      await db.query(
        `UPDATE ingestion_runs SET status = $1, rows_inserted = $2, rows_updated = $3, rows_failed = $4, finished_at = NOW() WHERE id = $5`,
        [status, rowsInserted, rowsUpdated, rowsFailed, runId]
      ).catch(() => {});
    }

    if (rowsInserted > 0 || rowsUpdated > 0) {
      try {
        const keys = await redis.keys('products:*');
        if (keys.length > 0) await redis.del(...keys);
        const searchKeys = await redis.keys('search:*');
        if (searchKeys.length > 0) await redis.del(...searchKeys);

        await redis.set(`bw:ingestion:last_success:${source}`, String(Date.now() / 1000));
        await redis.set(`bw:ingestion:products_last_run:${source}`, String(rowsInserted + rowsUpdated));
      } catch (e) {
        console.warn('[ingest] Cache invalidation failed:', (e as Error).message);
      }
    }

    const durationMs = Date.now() - start;
    res.set('X-Runtime-Ms', String(durationMs));

    res.status(errors.length > 0 && rowsInserted + rowsUpdated > 0 ? 207 : errors.length > 0 ? 207 : 200).json({
      run_id: runId,
      status,
      rows_inserted: rowsInserted,
      rows_updated: rowsUpdated,
      rows_failed: rowsFailed,
      errors: errors.length > 0 ? errors : undefined,
    });
  }
);

export default router;
