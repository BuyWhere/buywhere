"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runOutboundLinkProbeBatch = runOutboundLinkProbeBatch;
const config_1 = require("../config");
const outboundLinkHealth_1 = require("../lib/outboundLinkHealth");
const BATCH_SIZE = Math.max(1, Math.min(Number(process.env.OUTBOUND_PROBE_BATCH_SIZE) || 100, 1000));
const CONCURRENCY = Math.max(1, Math.min(Number(process.env.OUTBOUND_PROBE_CONCURRENCY) || 8, 32));
const TIMEOUT_MS = Math.max(1000, Number(process.env.OUTBOUND_PROBE_TIMEOUT_MS) || 10000);
const USER_AGENT = process.env.OUTBOUND_PROBE_UA || 'BuyWhereBot/1.0 (+https://buywhere.ai; outbound-link-health)';
const REFERER = process.env.OUTBOUND_PROBE_REFERER || 'https://buywhere.ai/';
async function indexIsValid(indexName) {
    try {
        const result = await config_1.db.query(`SELECT i.indisvalid
         FROM pg_index i
         JOIN pg_class c ON c.oid = i.indexrelid
        WHERE i.indrelid = 'public.products'::regclass
          AND c.relname = $1`, [indexName]);
        return result.rows.length > 0 && result.rows[0].indisvalid;
    }
    catch {
        return false;
    }
}
async function fetchDueRows() {
    // BUY-70938: idx_products_url_probe_due has been invalid on prod (failed CONCURRENTLY
    // builds). A full scan over ~394M products exceeds the 30s statement_timeout, so we
    // fall back to a primary-key-ordered scan over never-checked rows, which uses
    // idx_products_updated_at and completes in <5ms per batch.
    const dueIndexValid = await indexIsValid('idx_products_url_probe_due');
    if (dueIndexValid) {
        const result = await config_1.db.query(`SELECT id::text, merchant_id, url
         FROM products
        WHERE is_active = true
          AND url IS NOT NULL
          AND (url_last_checked_at IS NULL OR url_last_checked_at < NOW() - INTERVAL '24 hours')
        ORDER BY url_last_checked_at NULLS FIRST, updated_at DESC
        LIMIT $1`, [BATCH_SIZE]);
        return result.rows;
    }
    console.log('[outbound-probe] idx_products_url_probe_due missing/invalid; falling back to never-checked primary-key scan');
    const result = await config_1.db.query(`SELECT id::text, merchant_id, url
       FROM products
      WHERE is_active = true
        AND url IS NOT NULL
        AND url_last_checked_at IS NULL
      ORDER BY updated_at DESC
      LIMIT $1`, [BATCH_SIZE]);
    return result.rows;
}
async function probe(row) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const response = await fetch(row.url, {
            method: 'GET',
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                'User-Agent': USER_AGENT,
                'Referer': REFERER,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
        });
        const classification = (0, outboundLinkHealth_1.classifyProbeResult)({ statusCode: response.status, headers: response.headers });
        return {
            productId: row.id,
            merchantId: row.merchant_id,
            url: row.url,
            status: classification.status,
            reason: classification.reason,
            httpStatus: response.status,
            latencyMs: Date.now() - started,
            error: null,
        };
    }
    catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        const timedOut = error.name === 'AbortError';
        const classification = (0, outboundLinkHealth_1.classifyProbeResult)({ error, timedOut });
        return {
            productId: row.id,
            merchantId: row.merchant_id,
            url: row.url,
            status: classification.status,
            reason: classification.reason,
            httpStatus: null,
            latencyMs: Date.now() - started,
            error: error.message.slice(0, 500),
        };
    }
    finally {
        clearTimeout(timer);
    }
}
async function persist(result) {
    await config_1.db.query('BEGIN');
    try {
        await config_1.db.query(`INSERT INTO url_probe_log
         (product_id, merchant_id, url, status, reason, http_status, latency_ms, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [result.productId, result.merchantId, result.url, result.status, result.reason, result.httpStatus, result.latencyMs, result.error]);
        await config_1.db.query(`UPDATE products
          SET url_status = $2,
              url_status_reason = $3,
              url_last_checked_at = NOW(),
              url_dead_at = CASE
                WHEN $2 = 'dead' AND url_status <> 'dead' THEN NOW()
                WHEN $2 = 'dead' THEN COALESCE(url_dead_at, NOW())
                ELSE NULL
              END
        WHERE id = $1`, [result.productId, result.status, result.reason]);
        await config_1.db.query('COMMIT');
    }
    catch (err) {
        await config_1.db.query('ROLLBACK').catch(() => { });
        throw err;
    }
}
async function runPool(items, worker) {
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
        while (cursor < items.length) {
            const item = items[cursor++];
            await worker(item);
        }
    }));
}
async function runOutboundLinkProbeBatch() {
    if (!(0, outboundLinkHealth_1.outboundProbeEnabled)()) {
        console.log('[outbound-probe] disabled: set PROBE_OUTBOUND_LINKS=1 to run');
        return { scanned: 0, ok: 0, dead: 0, transient: 0 };
    }
    const rows = await fetchDueRows();
    const counts = { scanned: rows.length, ok: 0, dead: 0, transient: 0 };
    await runPool(rows, async (row) => {
        const result = await probe(row);
        await persist(result);
        counts[result.status] += 1;
        console.log(`[outbound-probe] ${result.status} product=${result.productId} http=${result.httpStatus ?? 'n/a'} ${result.latencyMs}ms reason=${result.reason}`);
    });
    return counts;
}
if (require.main === module) {
    runOutboundLinkProbeBatch()
        .then((counts) => {
        console.log('[outbound-probe] done', counts);
        process.exit(0);
    })
        .catch((err) => {
        console.error('[outbound-probe] failed:', err);
        process.exit(1);
    });
}
