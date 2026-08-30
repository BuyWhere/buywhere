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

const DB_LOCK_RETRYABLE_MESSAGES = [
  'database is locked',
  'database is busy',
  'database schema has changed',
];

function isRetryableDbError(err: unknown): boolean {
  const message = ((err as { message?: string; code?: string })?.message || '').toLowerCase();
  const code = (err as { code?: string })?.code;
  if (code === '55P03' || code === '40P01' || code === '40001') return true;
  return DB_LOCK_RETRYABLE_MESSAGES.some((pattern) => message.includes(pattern));
}

const DB_RETRY_ATTEMPTS = parseInt(process.env.INGEST_DB_RETRY_ATTEMPTS || '8', 10);

function asyncHandler(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[ingest] unhandled error on ${req.method} ${req.path}:`, message);
      if (!res.headersSent) {
        res.status(500).json({
          run_id: null,
          status: 'failed',
          rows_inserted: 0,
          rows_updated: 0,
          rows_failed: Array.isArray(req.body?.products) ? req.body.products.length : 0,
          errors: [{ index: -1, sku: 'batch', error: `Unhandled ingest error: ${message}`, code: 'unhandled_error' }],
        });
      }
    });
  };
}

async function withDbRetry<T>(operation: () => Promise<T>, label: string, maxRetries = DB_RETRY_ATTEMPTS): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (attempt >= maxRetries || !isRetryableDbError(err)) {
        throw err;
      }
      const delayMs = Math.min(1000, 200 * Math.pow(2, attempt));
      console.warn(`[ingest] ${label} retrying after lock error (attempt ${attempt + 1}/${maxRetries}) in ${delayMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

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

// GET /v1/ingest/health — ingestion pipeline health check.
//
// Auth: requires a valid API key via Authorization: Bearer or X-API-Key header.
// Bypass: requests with X-Internal-Monitoring: true skip the bot-UA filter and
// get full market-level freshness data. This header is intended for internal
// monitoring tools (scripts/check_ingestion_health.mjs, BUY-31745).
router.get('/health', async (req: Request, res: Response) => {
  const isInternal = req.headers['x-internal-monitoring'] === 'true';

  // For internal monitoring, skip the bot-UA check but still require auth.
  // For external callers the standard requireApiKey gate applies.
  return requireApiKey(req, res, async () => {
    try {
      const now = new Date();

      // Basic liveness: Redis ping
      let redisOk = false;
      try {
        redisOk = (await redis.ping()) === 'PONG';
      } catch { /* redis down — report degraded but continue */ }

      // Last ingestion run per source (recent 24 h) — quick scan
      const runsResult = await db.query(
        `SELECT source, status, MAX(started_at) AS last_run, COUNT(*) AS run_count
           FROM ingestion_runs
          WHERE started_at > NOW() - INTERVAL '24 hours'
          GROUP BY source, status
          ORDER BY source, last_run DESC`
      );

      // Aggregate per source: last_success, last_failure, success_count, failure_count
      const sourceMap: Record<string, {
        last_success: string | null;
        last_failure: string | null;
        success_count: number;
        failure_count: number;
      }> = {};
      for (const row of runsResult.rows) {
        if (!sourceMap[row.source]) {
          sourceMap[row.source] = { last_success: null, last_failure: null, success_count: 0, failure_count: 0 };
        }
        const entry = sourceMap[row.source];
        const ts = (row.last_run as Date).toISOString();
        if (row.status === 'completed' || row.status === 'completed_with_errors') {
          if (!entry.last_success || ts > entry.last_success) entry.last_success = ts;
          entry.success_count += parseInt(row.run_count, 10);
        } else if (row.status === 'failed') {
          if (!entry.last_failure || ts > entry.last_failure) entry.last_failure = ts;
          entry.failure_count += parseInt(row.run_count, 10);
        }
      }

      // Product freshness: products updated in last 24 h (approximate via reltuples for speed)
      let recentProducts24h: number | null = null;
      try {
        const freshnessResult = await db.query(
          `SELECT COUNT(*) AS cnt FROM products WHERE updated_at > NOW() - INTERVAL '24 hours'`
        );
        recentProducts24h = parseInt(freshnessResult.rows[0]?.cnt ?? '0', 10);
      } catch { /* skip on timeout */ }

      // Zombie runs: stuck in 'running' > 1 hour
      const zombieResult = await db.query(
        `SELECT COUNT(*) AS cnt FROM ingestion_runs
          WHERE status = 'running' AND started_at < NOW() - INTERVAL '1 hour'`
      );
      const zombieCount = parseInt(zombieResult.rows[0]?.cnt ?? '0', 10);

      const sources = Object.entries(sourceMap).map(([source, s]) => ({
        source,
        last_success: s.last_success,
        last_failure: s.last_failure,
        success_count_24h: s.success_count,
        failure_count_24h: s.failure_count,
      }));

      const overallStatus = zombieCount > 0 ? 'degraded'
        : sources.length === 0 ? 'idle'
        : 'ok';

      res.json({
        status: overallStatus,
        redis: redisOk ? 'ok' : 'degraded',
        sources,
        recent_products_24h: recentProducts24h,
        zombie_runs: zombieCount,
        ts: now.toISOString(),
        internal: isInternal,
      });
    } catch (err: unknown) {
      res.status(500).json({
        status: 'error',
        error: (err as Error).message || String(err),
        ts: new Date().toISOString(),
      });
    }
  });
});

// Shared ingestion handler — registered on /products, / (root), and /bulk
// so that POST /v1/ingest, POST /v1/ingest/products, POST /v1/ingest/bulk,
// POST /ingest/bulk, and POST /ingest all work (BUY-31929).
async function handleIngest(req: Request, res: Response): Promise<void> {
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

    if (source === 'shopify') {
      res.status(400).json({
        run_id: null, status: 'failed', rows_inserted: 0, rows_updated: 0, rows_failed: 0,
        errors: [{ index: 0, sku: 'request', error: 'Source "shopify" is deprecated; use "shopify_<domain>" (e.g. "shopify_focuscameracom")', code: 'deprecated_source' }],
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

    // Deduplicate by (sku, source, country_code) — PostgreSQL rejects ON CONFLICT DO UPDATE
    // when the same row would be affected twice in a single command. The unique constraint
    // on products is (sku, source, country_code) (see products_partitioned_sku_source_unique),
    // so the in-batch dedup key must match.
    {
      const seen = new Set<string>();
      const unique: IngestProductItem[] = [];
      for (const p of validProducts) {
        const key = `${p.sku} ${source} ${p.country_code || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(p);
      }
      if (unique.length < validProducts.length) {
        const dupes = validProducts.length - unique.length;
        validProducts.length = 0;
        validProducts.push(...unique);
        console.warn(`[ingest] Deduped ${dupes} duplicate (sku,source,country_code) tuple(s) from ${source} batch`);
      }
    }

    let runId: number | null = null;
    try {
      const runResult = await withDbRetry(
        () => db.query(
        `INSERT INTO ingestion_runs (source, status) VALUES ($1, 'running') RETURNING id`,
          [source]
        ),
        'create ingestion run'
      );
      runId = runResult.rows[0]?.id || null;
    } catch (e) {
      console.warn('[ingest] Failed to create ingestion run record:', (e as Error).message);
    }

    // The unique constraint is (sku, source, country_code), so the pre-existing check
    // must match — a (sku, source) hit in another country is a different row.
    const existingSkus = new Set<string>();
    const skuToId = new Map<string, number>();
    if (validProducts.length > 0) {
      const tuples = validProducts
        .map((p) => `('${p.sku.replace(/'/g, "''")}','${source.replace(/'/g, "''")}','${(p.country_code || '').replace(/'/g, "''")}')`)
        .join(',');
      const existingResult = await withDbRetry(
        () => db.query(
          `SELECT id, sku, source, country_code FROM products
             WHERE (sku, source, country_code) IN (${tuples})`,
        ),
        'select existing SKUs (sku, source, country_code)'
      );
      for (const r of existingResult.rows as { id: number; sku: string; source: string; country_code: string }[]) {
        const key = `${r.sku} ${r.source} ${r.country_code}`;
        existingSkus.add(key);
        skuToId.set(key, r.id);
      }
    }

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
          // products is partitioned by country_code; the partition's `region`
          // column is NOT NULL and the column default ('sg') only applies when
          // the column is omitted from the INSERT. We're listing the column,
          // so we must supply a value. Default to country_code lowercased,
          // then 'sg' as the last-resort fallback.
          p.region || (p.country_code ? p.country_code.toLowerCase() : null) || 'sg',
          p.country_code || null,
        );

        placeholders.push(
          `($${base},$${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13},$${base + 14})`
        );
      }

      await withDbRetry(
        () => db.query(
        `INSERT INTO products
           (sku, source, merchant_id, title, description, price, currency, url,
            image_url, category_path, brand, metadata, is_active, region, country_code)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (sku, source, country_code)
         DO UPDATE SET
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           price = EXCLUDED.price,
           currency = EXCLUDED.currency,
           url = EXCLUDED.url,
           image_url = COALESCE(NULLIF(EXCLUDED.image_url, ''), products.image_url),
           brand = EXCLUDED.brand,
           category_path = EXCLUDED.category_path,
           merchant_id = EXCLUDED.merchant_id,
           metadata = EXCLUDED.metadata,
           is_active = true,
           region = COALESCE(EXCLUDED.region, products.region),
           country_code = COALESCE(EXCLUDED.country_code, products.country_code),
           updated_at = NOW()`,
          values
        ),
        'upsert products batch'
      );

      for (const p of validProducts) {
        const key = `${p.sku} ${source} ${p.country_code || ''}`;
        if (existingSkus.has(key)) {
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
        await withDbRetry(
          () => db.query(
            `UPDATE ingestion_runs SET status = 'failed', error_message = $1, finished_at = NOW() WHERE id = $2`,
            [msg.slice(0, 500), runId]
          ),
          'mark run failed'
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

    const finalResult = await withDbRetry(
      () => db.query(
      `SELECT id, sku, source, country_code FROM products
         WHERE (sku, source, country_code) IN (${validProducts
           .map((p) => `('${p.sku.replace(/'/g, "''")}','${source.replace(/'/g, "''")}','${(p.country_code || '').replace(/'/g, "''")}')`)
           .join(',')})`,
      ),
      'select final product ids'
    );
    // skuToId was populated by the pre-existing check above; refresh with final IDs
    for (const r of finalResult.rows as { id: number; sku: string; source: string; country_code: string }[]) {
      skuToId.set(`${r.sku} ${r.source} ${r.country_code}`, r.id);
    }

    for (const p of validProducts) {
      const productId = skuToId.get(`${p.sku} ${source} ${p.country_code || ''}`);
      if (productId) {
        const base = priceHistoryValues.length + 1;
        priceHistoryValues.push(productId, p.price, p.currency || 'SGD', source);
        phPlaceholders.push(`($${base},$${base + 1},$${base + 2},$${base + 3})`);
      }
    }

    if (priceHistoryValues.length > 0) {
      try {
        await withDbRetry(
          () => db.query(
          `INSERT INTO price_history (product_id, price, currency, source)
           VALUES ${phPlaceholders.join(', ')}`,
            priceHistoryValues
          ),
          'insert price history'
        );
      } catch (e) {
        console.warn('[ingest] Price history insert failed:', (e as Error).message);
      }
    }

    const status = rowsFailed === 0 ? 'completed' : 'completed_with_errors';
    if (runId !== null) {
      await withDbRetry(
        () => db.query(
          `UPDATE ingestion_runs SET status = $1, rows_inserted = $2, rows_updated = $3, rows_failed = $4, finished_at = NOW() WHERE id = $5`,
          [status, rowsInserted, rowsUpdated, rowsFailed, runId]
        ),
        'mark run complete'
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

// Register the shared handler on all expected paths (BUY-31929)
router.post('/products', requireApiKey, asyncHandler(handleIngest));
router.post('/', requireApiKey, asyncHandler(handleIngest));       // POST /v1/ingest
router.post('/bulk', requireApiKey, asyncHandler(handleIngest));   // POST /v1/ingest/bulk


router.get('/runs', requireApiKey, asyncHandler(async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(String(req.query.limit), 10) || 50, 200);
  const offset = parseInt(String(req.query.offset), 10) || 0;
  const source = req.query.source as string | undefined;

  let query = `SELECT id, source, status, rows_inserted, rows_updated, rows_failed,
                      error_message, started_at, finished_at
               FROM ingestion_runs`;
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (source) {
    params.push(source);
    conditions.push(`source = $${params.length}`);
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(' AND ')}`;
  }

  query += ` ORDER BY started_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const result = await db.query(query, params);
  res.json({ runs: result.rows, limit, offset });
}));

router.get('/runs/:id', requireApiKey, asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid run id' });
    return;
  }
  const result = await db.query(
    `SELECT id, source, status, rows_inserted, rows_updated, rows_failed,
            error_message, started_at, finished_at
     FROM ingestion_runs WHERE id = $1`,
    [id]
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Run not found' });
    return;
  }
  res.json(result.rows[0]);
}));

export default router;
