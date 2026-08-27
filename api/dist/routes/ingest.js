"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const config_1 = require("../config");
const apiKey_1 = require("../middleware/apiKey");
const pricing_1 = require("../lib/pricing");
const router = (0, express_1.Router)();
const SOURCE_NORMALIZATION = {
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
function isRetryableDbError(err) {
    const message = (err?.message || '').toLowerCase();
    const code = err?.code;
    if (code === '55P03' || code === '40P01' || code === '40001')
        return true;
    return DB_LOCK_RETRYABLE_MESSAGES.some((pattern) => message.includes(pattern));
}
const DB_RETRY_ATTEMPTS = parseInt(process.env.INGEST_DB_RETRY_ATTEMPTS || '8', 10);
const INGEST_SCHEMA_GUARD_TTL_MS = parseInt(process.env.INGEST_SCHEMA_GUARD_TTL_MS || '60000', 10);
let ingestSchemaGuardCache = null;
function asyncHandler(fn) {
    return (req, res) => {
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
async function withDbRetry(operation, label, maxRetries = DB_RETRY_ATTEMPTS) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        }
        catch (err) {
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
async function ensureProductsConflictTarget() {
    if (ingestSchemaGuardCache && (Date.now() - ingestSchemaGuardCache.checkedAt) < INGEST_SCHEMA_GUARD_TTL_MS) {
        return ingestSchemaGuardCache;
    }
    try {
        const result = await config_1.db.query(`SELECT
         (SELECT c.relkind
            FROM pg_class c
           WHERE c.oid = 'public.products'::regclass) AS relkind,
         (
           -- Exact (sku, source, country_code) UNIQUE constraint (original BUY-55081 path).
           EXISTS (
             SELECT 1
               FROM pg_constraint con
              WHERE con.conrelid = 'public.products'::regclass
                AND con.contype = 'u'
                AND con.convalidated
                AND ARRAY(
                  SELECT att.attname::text
                    FROM unnest(con.conkey) WITH ORDINALITY AS cols(attnum, ord)
                    JOIN pg_attribute att
                      ON att.attrelid = con.conrelid
                     AND att.attnum = cols.attnum
                   ORDER BY cols.ord
                ) = ARRAY['sku', 'source', 'country_code']
           )
           -- BUY-55921 hot-patch: also accept (sku, source) and (sku, source, country_code)
           -- UNIQUE INDEXes against public.products. PostgreSQL's ON CONFLICT inference
           -- requires the target columns to be a prefix of the index columns; maglev
           -- only has the 2-col index (sku, source), so the live ingest must be running
           -- with ON CONFLICT (sku, source) for that path to work. The guard now passes
           -- whenever any valid 2-col or 3-col unique index/constraint exists on products,
           -- unblocking ingest in the legacy 2-col state (maglev on 2026-06-23). The
           -- named shell products_sku_source_country_unique is explicitly excluded if
           -- it is a partial-index shell with indisvalid=false (the cancelled CIC left
           -- such a shell on maglev with WHERE country_code IS NOT NULL).
           OR EXISTS (
             SELECT 1
               FROM pg_index i
               JOIN pg_class ic ON ic.oid = i.indexrelid
              WHERE i.indrelid = 'public.products'::regclass
                AND i.indisunique
                AND i.indisvalid
                AND NOT i.indisexclusion
                -- OPS BUY-55921 simplification: i.indisvalid already excludes invalid partial indexes,
                -- so the named-shell exclusion is redundant. Removed to fix live 503.
                AND ARRAY(
                  SELECT att.attname::text
                    FROM unnest(i.indkey) WITH ORDINALITY AS cols(attnum, ord)
                    JOIN pg_attribute att
                      ON att.attrelid = i.indrelid
                     AND att.attnum = cols.attnum
                   ORDER BY cols.ord
                ) = ARRAY['sku', 'source', 'country_code']
           )
           OR EXISTS (
             SELECT 1
               FROM pg_index i
               JOIN pg_class ic ON ic.oid = i.indexrelid
              WHERE i.indrelid = 'public.products'::regclass
                AND i.indisunique
                AND i.indisvalid
                AND NOT i.indisexclusion
                -- OPS BUY-55921 simplification: i.indisvalid already excludes invalid partial indexes,
                -- so the named-shell exclusion is redundant. Removed to fix live 503.
                AND ARRAY(
                  SELECT att.attname::text
                    FROM unnest(i.indkey) WITH ORDINALITY AS cols(attnum, ord)
                    JOIN pg_attribute att
                      ON att.attrelid = i.indrelid
                     AND att.attnum = cols.attnum
                   ORDER BY cols.ord
                ) = ARRAY['sku', 'source']
           )
         ) AS has_conflict_target,
         -- BUY-56338: return the exact column list for the ON CONFLICT target so the
         -- INSERT can match the unique index that actually exists in the database.
         -- Prefer 3-col (sku, source, country_code); fall back to 2-col (sku, source).
         COALESCE(
           (
             SELECT ARRAY['sku', 'source', 'country_code']
               FROM pg_index i
              WHERE i.indrelid = 'public.products'::regclass
                AND i.indisunique AND i.indisvalid AND NOT i.indisexclusion
                AND ARRAY(
                  SELECT att.attname::text
                    FROM unnest(i.indkey) WITH ORDINALITY AS cols(attnum, ord)
                    JOIN pg_attribute att
                      ON att.attrelid = i.indrelid AND att.attnum = cols.attnum
                   ORDER BY cols.ord
                ) = ARRAY['sku', 'source', 'country_code']
              LIMIT 1
           ),
           (
             SELECT ARRAY['sku', 'source']
               FROM pg_index i
              WHERE i.indrelid = 'public.products'::regclass
                AND i.indisunique AND i.indisvalid AND NOT i.indisexclusion
                AND ARRAY(
                  SELECT att.attname::text
                    FROM unnest(i.indkey) WITH ORDINALITY AS cols(attnum, ord)
                    JOIN pg_attribute att
                      ON att.attrelid = i.indrelid AND att.attnum = cols.attnum
                   ORDER BY cols.ord
                ) = ARRAY['sku', 'source']
              LIMIT 1
           ),
           (
             SELECT ARRAY['sku', 'source', 'country_code']
               FROM pg_constraint con
              WHERE con.conrelid = 'public.products'::regclass
                AND con.contype = 'u' AND con.convalidated
                AND ARRAY(
                  SELECT att.attname::text
                    FROM unnest(con.conkey) WITH ORDINALITY AS cols(attnum, ord)
                    JOIN pg_attribute att
                      ON att.attrelid = con.conrelid AND att.attnum = cols.attnum
                   ORDER BY cols.ord
                ) = ARRAY['sku', 'source', 'country_code']
              LIMIT 1
           )
         ) AS conflict_columns,
         inet_server_addr()::text AS server_addr,
         inet_server_port() AS server_port,
         pg_postmaster_start_time()::text AS postmaster_start_time`);
        const row = result.rows[0];
        const rawConflictColumns = row?.conflict_columns;
        const conflictColumns = Array.isArray(rawConflictColumns) && rawConflictColumns.every((c) => c === 'sku' || c === 'source' || c === 'country_code')
            ? rawConflictColumns
            : null;
        const guardResult = {
            ok: Boolean(row?.has_conflict_target) && conflictColumns !== null,
            checkedAt: Date.now(),
            relkind: row?.relkind ?? null,
            serverAddr: row?.server_addr ?? null,
            serverPort: row?.server_port ?? null,
            postmasterStartTime: row?.postmaster_start_time ?? null,
            conflictColumns,
        };
        if (!guardResult.ok) {
            guardResult.error =
                'products is missing a valid UNIQUE conflict target covering (sku, source) or ' +
                    '(sku, source, country_code) (constraint or index); check DATABASE_URL / schema wiring';
            console.error(`[ingest] schema guard failed: ${guardResult.error} ` +
                `(relkind=${guardResult.relkind ?? 'unknown'} ` +
                `server=${guardResult.serverAddr ?? 'unknown'}:${guardResult.serverPort ?? 0} ` +
                `postmasterStart=${guardResult.postmasterStartTime ?? 'unknown'})`);
        }
        ingestSchemaGuardCache = guardResult;
        return guardResult;
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const guardResult = {
            ok: false,
            checkedAt: Date.now(),
            relkind: null,
            serverAddr: null,
            serverPort: null,
            postmasterStartTime: null,
            conflictColumns: null,
            error: `schema guard query failed: ${message}`,
        };
        console.error('[ingest] schema guard query failed:', message);
        ingestSchemaGuardCache = guardResult;
        return guardResult;
    }
}
function normalizeSource(source) {
    return SOURCE_NORMALIZATION[source] || source;
}
function validateProduct(item, index, source) {
    if (!item || typeof item !== 'object') {
        return {
            valid: null,
            error: { index, sku: 'unknown', error: 'Not an object', code: 'validation_error' },
        };
    }
    const p = item;
    const sku = typeof p.sku === 'string' ? p.sku : '';
    const err = (msg, code) => ({ index, sku: sku || 'unknown', error: msg, code });
    if (!sku)
        return { valid: null, error: err('Missing sku', 'validation_sku_required') };
    if (!p.merchant_id || typeof p.merchant_id !== 'string')
        return { valid: null, error: err('Missing merchant_id', 'validation_merchant_id_required') };
    if (!p.title || typeof p.title !== 'string')
        return { valid: null, error: err('Missing title', 'validation_title_required') };
    if (p.price === undefined || p.price === null || typeof p.price !== 'number' || p.price < 0) {
        return { valid: null, error: err('Missing or invalid price (must be >= 0)', 'validation_price_non_positive') };
    }
    // BUY-73321: reject price outliers at ingest time to protect search result quality.
    const priceCurrency = typeof p.currency === 'string' ? p.currency : 'SGD';
    const priceCheck = (0, pricing_1.validatePrice)(p.price, priceCurrency);
    if (priceCheck.verdict === 'hard_reject') {
        return { valid: null, error: err(priceCheck.reason || 'Price outside valid range', 'validation_price_outlier') };
    }
    if (priceCheck.verdict === 'outlier') {
        console.warn(`[ingest] price outlier: sku=${sku} price=${p.price} ${priceCurrency} — ${priceCheck.reason}`);
    }
    if (!p.url || typeof p.url !== 'string')
        return { valid: null, error: err('Missing url', 'validation_url_invalid') };
    const product = {
        sku,
        merchant_id: String(p.merchant_id),
        title: String(p.title).slice(0, 1000),
        price: p.price,
        currency: typeof p.currency === 'string' ? p.currency : 'SGD',
        url: String(p.url),
    };
    if (typeof p.description === 'string')
        product.description = String(p.description).slice(0, 5000);
    if (typeof p.image_url === 'string')
        product.image_url = p.image_url;
    if (typeof p.category === 'string')
        product.category = p.category;
    if (Array.isArray(p.category_path))
        product.category_path = p.category_path.map(String).slice(0, 10);
    if (typeof p.brand === 'string')
        product.brand = String(p.brand).slice(0, 200);
    if (typeof p.is_active === 'boolean')
        product.is_active = p.is_active;
    if (typeof p.is_available === 'boolean')
        product.is_available = p.is_available;
    if (typeof p.in_stock === 'boolean')
        product.in_stock = p.in_stock;
    if (typeof p.stock_level === 'string')
        product.stock_level = p.stock_level;
    if (typeof p.availability === 'string')
        product.availability = p.availability;
    if (p.last_checked && typeof p.last_checked === 'string')
        product.last_checked = p.last_checked;
    if (p.metadata && typeof p.metadata === 'object')
        product.metadata = p.metadata;
    if (typeof p.country_code === 'string')
        product.country_code = p.country_code;
    else if (p.metadata && typeof p.metadata === 'object') {
        const meta = p.metadata;
        if (typeof meta.country_code === 'string')
            product.country_code = meta.country_code;
    }
    if (typeof p.region === 'string')
        product.region = p.region;
    else if (p.metadata && typeof p.metadata === 'object') {
        const meta = p.metadata;
        if (typeof meta.region === 'string')
            product.region = meta.region;
    }
    return { valid: product, error: null };
}
function buildCategoryPathLiteral(paths) {
    if (!paths || paths.length === 0)
        return '{}';
    return `{${paths.map(c => `"${c.replace(/"/g, '\\"')}"`).join(',')}}`;
}
// Health response cache (BUY-57333): serve cached status for up to 30s to
// reduce DB load during congestion. Internal monitoring bypasses the cache.
const HEALTH_CACHE_TTL_MS = parseInt(process.env.HEALTH_CACHE_TTL_MS || '30000', 10);
let healthCache = null;
async function cleanupZombieIngestionRuns() {
    const result = await config_1.db.query(`SET statement_timeout = 3000`).then(() => config_1.db.query(`UPDATE ingestion_runs
        SET status = 'failed',
            error_message = 'Auto-cleaned: run stuck in running status for >1h (ingest health cleanup)',
            finished_at = started_at + INTERVAL '1 hour'
      WHERE status = 'running' AND started_at < NOW() - INTERVAL '1 hour'`)).finally(() => {
        config_1.db.query(`SET statement_timeout = 30000`).catch(() => { });
    });
    return result.rowCount || 0;
}
// GET /v1/ingest/health — ingestion pipeline health check.
//
// Auth: requires a valid API key via Authorization: Bearer or X-API-Key header.
// Bypass: requests with X-Internal-Monitoring: true skip the bot-UA filter and
// get full market-level freshness data. This header is intended for internal
// monitoring tools (scripts/check_ingestion_health.mjs, BUY-31745).
router.get('/health', async (req, res) => {
    // Serve from cache if within TTL (internal monitoring bypasses cache)
    if (healthCache && (Date.now() - healthCache.ts) < HEALTH_CACHE_TTL_MS && req.headers['x-internal-monitoring'] !== 'true') {
        const cached = healthCache.data;
        return res.json({ ...cached, cached: true, ts: new Date().toISOString() });
    }
    const isInternal = req.headers['x-internal-monitoring'] === 'true';
    // For internal monitoring, skip the bot-UA check but still require auth.
    // For external callers the standard requireApiKey gate applies.
    return (0, apiKey_1.requireApiKey)(req, res, async () => {
        try {
            const now = new Date();
            // Basic liveness: Redis ping
            let redisOk = false;
            try {
                redisOk = await Promise.race([
                    config_1.redis.ping().then(r => r === 'PONG'),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('redis ping timed out')), 1000)),
                ]);
            }
            catch { /* redis down — report degraded but continue */ }
            // Last ingestion run per source (recent 24 h) — quick scan
            const runsResult = await config_1.db.query(`SET statement_timeout = 3000`).then(() => config_1.db.query(`SELECT source, status, MAX(started_at) AS last_run, COUNT(*) AS run_count
           FROM ingestion_runs
          WHERE started_at > NOW() - INTERVAL '24 hours'
          GROUP BY source, status
          ORDER BY source, last_run DESC`)).finally(() => {
                config_1.db.query(`SET statement_timeout = 30000`).catch(() => { });
            });
            // Aggregate per source: last_success, last_failure, success_count, failure_count
            const sourceMap = {};
            for (const row of runsResult.rows) {
                if (!sourceMap[row.source]) {
                    sourceMap[row.source] = { last_success: null, last_failure: null, success_count: 0, failure_count: 0 };
                }
                const entry = sourceMap[row.source];
                const ts = row.last_run.toISOString();
                if (row.status === 'completed' || row.status === 'completed_with_errors') {
                    if (!entry.last_success || ts > entry.last_success)
                        entry.last_success = ts;
                    entry.success_count += parseInt(row.run_count, 10);
                }
                else if (row.status === 'failed') {
                    if (!entry.last_failure || ts > entry.last_failure)
                        entry.last_failure = ts;
                    entry.failure_count += parseInt(row.run_count, 10);
                }
            }
            // Product freshness: products updated in last 24 h (approximate via reltuples for speed)
            let recentProducts24h = null;
            try {
                const freshnessResult = await config_1.db.query(`SET statement_timeout = 3000`).then(() => config_1.db.query(`SELECT COUNT(*) AS cnt FROM products WHERE updated_at > NOW() - INTERVAL '24 hours'`)).finally(() => {
                    config_1.db.query(`SET statement_timeout = 30000`).catch(() => { });
                });
                recentProducts24h = parseInt(freshnessResult.rows[0]?.cnt ?? '0', 10);
            }
            catch { /* skip on timeout */ }
            // Zombie runs: stuck in 'running' > 1 hour. Clean first so this endpoint
            // reports the effective post-cleanup state, matching the cron healthcheck.
            const zombieRunsCleaned = await cleanupZombieIngestionRuns();
            const zombieResult = await config_1.db.query(`SET statement_timeout = 3000`).then(() => config_1.db.query(`SELECT COUNT(*) AS cnt FROM ingestion_runs
          WHERE status = 'running' AND started_at < NOW() - INTERVAL '1 hour'`)).finally(() => {
                config_1.db.query(`SET statement_timeout = 30000`).catch(() => { });
            });
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
            const responseBody = {
                status: overallStatus,
                redis: redisOk ? 'ok' : 'degraded',
                sources,
                recent_products_24h: recentProducts24h,
                zombie_runs: zombieCount,
                zombie_runs_cleaned: zombieRunsCleaned,
                ts: now.toISOString(),
                internal: isInternal,
            };
            healthCache = { data: responseBody, ts: Date.now() };
            res.json(responseBody);
        }
        catch (err) {
            res.status(500).json({
                status: 'error',
                error: err.message || String(err),
                ts: new Date().toISOString(),
            });
        }
    });
});
// Shared ingestion handler — registered on /products, / (root), and /bulk
// so that POST /v1/ingest, POST /v1/ingest/products, POST /v1/ingest/bulk,
// POST /ingest/bulk, and POST /ingest all work (BUY-31929).
async function handleIngest(req, res) {
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
    const validProducts = [];
    const errors = [];
    for (let i = 0; i < body.products.length; i++) {
        const { valid, error } = validateProduct(body.products[i], i, source);
        if (valid)
            validProducts.push(valid);
        if (error)
            errors.push(error);
    }
    if (validProducts.length === 0) {
        res.status(207).json({
            run_id: null, status: 'failed', rows_inserted: 0, rows_updated: 0,
            rows_failed: errors.length, errors,
        });
        return;
    }
    const schemaGuard = await ensureProductsConflictTarget();
    if (!schemaGuard.ok) {
        res.status(503).json({
            run_id: null,
            status: 'failed',
            rows_inserted: 0,
            rows_updated: 0,
            rows_failed: validProducts.length + errors.length,
            errors: [
                {
                    index: -1,
                    sku: 'batch',
                    error: `Database schema mismatch: ${schemaGuard.error || 'missing products conflict target'} ` +
                        `(relkind=${schemaGuard.relkind ?? 'unknown'}, ` +
                        `server=${schemaGuard.serverAddr ?? 'unknown'}:${schemaGuard.serverPort ?? 0}, ` +
                        `postmaster_start=${schemaGuard.postmasterStartTime ?? 'unknown'})`,
                    code: 'database_schema_mismatch',
                },
                ...errors,
            ],
        });
        return;
    }
    const conflictCols = (schemaGuard.conflictColumns && schemaGuard.conflictColumns.length > 0)
        ? schemaGuard.conflictColumns
        : ['sku', 'source', 'country_code'];
    const productKey = (p) => {
        const parts = [p.sku, source];
        if (conflictCols.includes('country_code'))
            parts.push(p.country_code || '');
        return parts.join('\u0000');
    };
    const rowKey = (r) => {
        const parts = [r.sku, r.source];
        if (conflictCols.includes('country_code'))
            parts.push(r.country_code || '');
        return parts.join('\u0000');
    };
    // Deduplicate by the active products conflict target. PostgreSQL rejects
    // ON CONFLICT DO UPDATE when the same row would be affected twice in one
    // command, and this catalog can use either a 2-column or 3-column target.
    {
        const seen = new Set();
        const unique = [];
        for (const p of validProducts) {
            const key = productKey(p);
            if (seen.has(key))
                continue;
            seen.add(key);
            unique.push(p);
        }
        if (unique.length < validProducts.length) {
            const dupes = validProducts.length - unique.length;
            validProducts.length = 0;
            validProducts.push(...unique);
            console.warn(`[ingest] Deduped ${dupes} duplicate (${conflictCols.join(',')}) tuple(s) from ${source} batch`);
        }
    }
    let runId = null;
    try {
        const runResult = await withDbRetry(() => config_1.db.query(`INSERT INTO ingestion_runs (source, status) VALUES ($1, 'running') RETURNING id`, [source]), 'create ingestion run');
        runId = runResult.rows[0]?.id || null;
    }
    catch (e) {
        console.warn('[ingest] Failed to create ingestion run record:', e.message);
    }
    // Match the actual conflict target from the schema guard. The production
    // catalog may use either (sku, source) or (sku, source, country_code); using
    // the wrong precheck key over-reports updates as new rows in ingestion_runs.
    const existingSkus = new Set();
    const skuToId = new Map();
    if (validProducts.length > 0) {
        const tupleColumns = conflictCols.join(', ');
        const tuples = validProducts.map((p) => {
            const valuesForKey = conflictCols.map((col) => {
                const value = col === 'sku' ? p.sku : col === 'source' ? source : p.country_code || '';
                return `'${value.replace(/'/g, "''")}'`;
            });
            return `(${valuesForKey.join(',')})`;
        }).join(',');
        const existingResult = await withDbRetry(() => config_1.db.query(`SELECT id, sku, source, country_code FROM products
             WHERE (${tupleColumns}) IN (${tuples})`), `select existing SKUs (${tupleColumns})`);
        for (const r of existingResult.rows) {
            const key = rowKey(r);
            existingSkus.add(key);
            skuToId.set(key, r.id);
        }
    }
    let rowsInserted = 0;
    let rowsUpdated = 0;
    let rowsFailed = errors.length;
    try {
        const values = [];
        const placeholders = [];
        for (const p of validProducts) {
            const base = values.length + 1;
            const metadata = {
                ...(p.metadata || {}),
                origin_merchant_id: p.merchant_id,
                availability: p.availability || 'in_stock',
                category: p.category || null,
            };
            if (p.in_stock !== undefined)
                metadata.in_stock = p.in_stock;
            if (p.stock_level !== undefined)
                metadata.stock_level = p.stock_level;
            if (p.is_available !== undefined)
                metadata.is_available = p.is_available;
            if (p.last_checked !== undefined)
                metadata.last_checked = p.last_checked;
            values.push(p.sku, source, p.merchant_id, p.title, p.description || null, p.price, p.currency || 'SGD', p.url, p.image_url || null, buildCategoryPathLiteral(p.category_path), p.brand || null, JSON.stringify(metadata), p.is_active !== false, 
            // products is partitioned by country_code; the partition's `region`
            // column is NOT NULL and the column default ('sg') only applies when
            // the column is omitted from the INSERT. We're listing the column,
            // so we must supply a value. Default to country_code lowercased,
            // then 'sg' as the last-resort fallback.
            p.region || (p.country_code ? p.country_code.toLowerCase() : null) || 'sg', p.country_code || null);
            placeholders.push(`($${base},$${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13},$${base + 14})`);
        }
        // BUY-56338: pick the ON CONFLICT target dynamically from the schema guard
        // so the INSERT matches the unique index that actually exists in the database.
        // PostgreSQL requires ON CONFLICT columns to match a valid unique index exactly.
        // The guard returns either ['sku', 'source', 'country_code'] (3-col) or
        // ['sku', 'source'] (2-col). We previously hardcoded 3-col, which broke ingest
        // when the DB only had the 2-col index — the guard would pass but the INSERT
        // would fail with "no unique or exclusion constraint matching the ON CONFLICT".
        const conflictTarget = `(${conflictCols.join(', ')})`;
        // BUY-64988: RETURNING (xmax = 0) AS inserted is the canonical truth
        // for whether the upsert created a fresh row. The precheck
        // `existingSkus` set is unreliable when the products conflict target
        // drifts between (sku, source) and (sku, source, country_code); that
        // drift caused rows_inserted to be bumped for updates, while
        // products.created_at was never stamped (DO UPDATE branch leaves the
        // column alone). Counting (xmax = 0) from RETURNING puts rows_inserted
        // back in sync with COUNT(products.created_at in same hour).
        const upsertResult = await withDbRetry(() => config_1.db.query(`INSERT INTO products
           (sku, source, merchant_id, title, description, price, currency, url,
            image_url, category_path, brand, metadata, is_active, region, country_code)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT ${conflictTarget}
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
           updated_at = NOW()
         RETURNING (xmax = 0) AS inserted, sku`, values), 'upsert products batch');
        rowsInserted = 0;
        rowsUpdated = 0;
        for (const r of upsertResult.rows) {
            if (r.inserted)
                rowsInserted++;
            else
                rowsUpdated++;
        }
    }
    catch (e) {
        const msg = e.message;
        console.error('[ingest] Bulk upsert failed:', msg);
        rowsFailed += validProducts.length;
        rowsInserted = 0;
        rowsUpdated = 0;
        if (!errors.some(err => err.code === 'database_error')) {
            errors.unshift({ index: -1, sku: 'batch', error: `Database error: ${msg}`, code: 'database_error' });
        }
        if (runId !== null) {
            await withDbRetry(() => config_1.db.query(`UPDATE ingestion_runs SET status = 'failed', error_message = $1, finished_at = NOW() WHERE id = $2`, [msg.slice(0, 500), runId]), 'mark run failed').catch(() => { });
        }
        res.status(207).json({
            run_id: runId, status: 'failed', rows_inserted: 0, rows_updated: 0,
            rows_failed: rowsFailed, errors,
        });
        return;
    }
    const priceHistoryValues = [];
    const phPlaceholders = [];
    const finalResult = await withDbRetry(() => config_1.db.query(`SELECT id, sku, source, country_code FROM products
         WHERE (${conflictCols.join(', ')}) IN (${validProducts
        .map((p) => `(${conflictCols.map((col) => {
        const value = col === 'sku' ? p.sku : col === 'source' ? source : p.country_code || '';
        return `'${value.replace(/'/g, "''")}'`;
    }).join(',')})`)
        .join(',')})`), 'select final product ids');
    // skuToId was populated by the pre-existing check above; refresh with final IDs
    for (const r of finalResult.rows) {
        skuToId.set(rowKey(r), r.id);
    }
    for (const p of validProducts) {
        const productId = skuToId.get(productKey(p));
        if (productId) {
            const base = priceHistoryValues.length + 1;
            priceHistoryValues.push(productId, p.price, p.currency || 'SGD', source);
            phPlaceholders.push(`($${base},$${base + 1},$${base + 2},$${base + 3})`);
        }
    }
    if (priceHistoryValues.length > 0) {
        try {
            await withDbRetry(() => config_1.db.query(`INSERT INTO price_history (product_id, price, currency, source)
           VALUES ${phPlaceholders.join(', ')}`, priceHistoryValues), 'insert price history');
        }
        catch (e) {
            console.warn('[ingest] Price history insert failed:', e.message);
        }
    }
    const status = rowsFailed === 0 ? 'completed' : 'completed_with_errors';
    if (runId !== null) {
        await withDbRetry(() => config_1.db.query(`UPDATE ingestion_runs SET status = $1, rows_inserted = $2, rows_updated = $3, rows_failed = $4, finished_at = NOW() WHERE id = $5`, [status, rowsInserted, rowsUpdated, rowsFailed, runId]), 'mark run complete').catch(() => { });
    }
    if (rowsInserted > 0 || rowsUpdated > 0) {
        try {
            const keys = await config_1.redis.keys('products:*');
            if (keys.length > 0)
                await config_1.redis.del(...keys);
            const searchKeys = await config_1.redis.keys('search:*');
            if (searchKeys.length > 0)
                await config_1.redis.del(...searchKeys);
            // BUY-75291: also bust MCP /search_products fts:v7:* so reindexed
            // products surface immediately instead of staying frozen at the
            // first-hit snapshot for the full MCP_FTS_CACHE_TTL.
            const ftsKeys = await config_1.redis.keys('fts:v7:*');
            if (ftsKeys.length > 0)
                await config_1.redis.del(...ftsKeys);
            await config_1.redis.set(`bw:ingestion:last_success:${source}`, String(Date.now() / 1000));
            await config_1.redis.set(`bw:ingestion:products_last_run:${source}`, String(rowsInserted + rowsUpdated));
        }
        catch (e) {
            console.warn('[ingest] Cache invalidation failed:', e.message);
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
router.post('/products', apiKey_1.requireApiKey, asyncHandler(handleIngest));
router.post('/', apiKey_1.requireApiKey, asyncHandler(handleIngest)); // POST /v1/ingest
router.post('/bulk', apiKey_1.requireApiKey, asyncHandler(handleIngest)); // POST /v1/ingest/bulk
router.get('/runs', apiKey_1.requireApiKey, asyncHandler(async (req, res) => {
    const limit = Math.min(parseInt(String(req.query.limit), 10) || 50, 200);
    const offset = parseInt(String(req.query.offset), 10) || 0;
    const source = req.query.source;
    let query = `SELECT id, source, status, rows_inserted, rows_updated, rows_failed,
                      error_message, started_at, finished_at
               FROM ingestion_runs`;
    const params = [];
    const conditions = [];
    if (source) {
        params.push(source);
        conditions.push(`source = $${params.length}`);
    }
    if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(' AND ')}`;
    }
    query += ` ORDER BY started_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);
    const result = await config_1.db.query(query, params);
    res.json({ runs: result.rows, limit, offset });
}));
router.get('/runs/:id', apiKey_1.requireApiKey, asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid run id' });
        return;
    }
    const result = await config_1.db.query(`SELECT id, source, status, rows_inserted, rows_updated, rows_failed,
            error_message, started_at, finished_at
     FROM ingestion_runs WHERE id = $1`, [id]);
    if (result.rows.length === 0) {
        res.status(404).json({ error: 'Run not found' });
        return;
    }
    res.json(result.rows[0]);
}));
exports.default = router;
