"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const config_1 = require("../../config");
const outboundLinkHealth_1 = require("../../lib/outboundLinkHealth");
const auth_1 = require("./auth");
const router = (0, express_1.Router)();
const DEFAULT_LOG_LIMIT = 100;
const MAX_LOG_LIMIT = 1000;
function parsePagination(req) {
    const rawLimit = parseInt(req.query.limit || `${DEFAULT_LOG_LIMIT}`, 10);
    const limit = Number.isNaN(rawLimit) ? DEFAULT_LOG_LIMIT : Math.min(Math.max(rawLimit, 1), MAX_LOG_LIMIT);
    const rawOffset = parseInt(req.query.offset || '0', 10);
    const offset = Number.isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;
    const cursor = req.query.cursor || '';
    let cursorCheckedAt = null;
    let cursorId = null;
    if (cursor) {
        const lastColon = cursor.lastIndexOf(':');
        if (lastColon > 0 && lastColon < cursor.length - 1) {
            cursorCheckedAt = cursor.slice(0, lastColon) || null;
            cursorId = cursor.slice(lastColon + 1) || null;
        }
    }
    return {
        limit,
        offset,
        cursorCheckedAt,
        cursorId,
        status: req.query.status || null,
        productId: req.query.product_id || null,
        since: req.query.since || null,
        until: req.query.until || null,
    };
}
async function getProbesLogs(req, res) {
    const { limit, offset, cursorCheckedAt, cursorId, status, productId, since, until } = parsePagination(req);
    const whereClauses = [];
    const params = [];
    let paramIndex = 1;
    if (status) {
        whereClauses.push(`status = $${paramIndex++}`);
        params.push(status);
    }
    if (productId) {
        whereClauses.push(`product_id = $${paramIndex++}`);
        params.push(productId);
    }
    if (since) {
        whereClauses.push(`checked_at >= $${paramIndex++}`);
        params.push(since);
    }
    if (until) {
        whereClauses.push(`checked_at <= $${paramIndex++}`);
        params.push(until);
    }
    if (cursorCheckedAt && cursorId) {
        // Keyset pagination: rows older than the cursor (checked_at, id) pair.
        whereClauses.push(`(checked_at, id) < ($${paramIndex++}, $${paramIndex++})`);
        params.push(cursorCheckedAt, cursorId);
    }
    const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const rowsSql = `
    SELECT id, product_id, merchant_id, url, status, reason,
           http_status AS response_code, checked_at, latency_ms
      FROM url_probe_log
      ${where}
     ORDER BY checked_at DESC, id DESC
     LIMIT $${paramIndex++}
     OFFSET $${paramIndex++}
  `;
    params.push(limit, offset);
    const countSql = `
    SELECT COUNT(*)::text AS total
      FROM url_probe_log
      ${where}
  `;
    try {
        const [rowsResult, countResult] = await Promise.all([
            config_1.db.query(rowsSql, params),
            config_1.db.query(countSql, params.slice(0, -2)), // exclude limit/offset from count
        ]);
        const rows = rowsResult.rows;
        const total = Number(countResult.rows[0]?.total || '0');
        const lastRow = rows[rows.length - 1];
        const nextCursor = lastRow
            ? `${lastRow.checked_at.toISOString ? lastRow.checked_at.toISOString() : lastRow.checked_at}:${lastRow.id}`
            : null;
        res.json({
            data: rows,
            pagination: {
                limit,
                offset,
                total,
                returned: rows.length,
                next_cursor: nextCursor,
                has_more: offset + rows.length < total,
            },
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: 'QUERY_FAILED', message });
    }
}
async function getProbesStatus(_req, res) {
    // BUY-70938: products has ~394M rows; full-table COUNT(*) seq-scans time out
    // when the url_probe_due index is invalid. Use approximate counts from pg_class
    // and pg_stats so the endpoint returns quickly regardless of index state.
    const approxTotal = await config_1.db.query(`SELECT reltuples::bigint AS total FROM pg_class WHERE relname = 'products'`).catch(() => ({ rows: [{ total: '0' }] }));
    const approxNeverChecked = await config_1.db.query(`SELECT ROUND(c.reltuples * COALESCE(s.null_frac, 0))::bigint AS never_checked
       FROM pg_class c
       LEFT JOIN pg_stats s ON s.schemaname = 'public'
                           AND s.tablename = 'products'
                           AND s.attname = 'url_last_checked_at'
      WHERE c.relname = 'products'`).catch(() => ({ rows: [{ never_checked: '0' }] }));
    // BUY-71096: url_probe_log currently has no checked_at-leading index on prod.
    // Query only the trailing ~25h window so idx_url_probe_log_status_checked_at
    // keeps the endpoint fast even as the log grows.
    const runSummary = await config_1.db.query(`SELECT MAX(checked_at) FILTER (WHERE checked_at > NOW() - INTERVAL '25 hours') AS last_run_at,
            MAX(checked_at) FILTER (WHERE status = 'ok' AND checked_at > NOW() - INTERVAL '25 hours') AS last_success_at
       FROM url_probe_log`).catch(() => ({ rows: [{ last_run_at: null, last_success_at: null }] }));
    const lastRunAt = runSummary.rows[0]?.last_run_at;
    const rowsCheckedLastRun = lastRunAt
        ? await config_1.db.query(`SELECT COUNT(*)::text AS count
           FROM url_probe_log
          WHERE checked_at > $1::timestamptz - INTERVAL '2 minutes'
            AND checked_at <= $1::timestamptz + INTERVAL '2 minutes'`, [lastRunAt]).catch(() => ({ rows: [{ count: '0' }] }))
        : { rows: [{ count: '0' }] };
    const recent = await config_1.db.query(`SELECT status, COUNT(*)::text AS count
       FROM url_probe_log
      WHERE checked_at > NOW() - INTERVAL '24 hours'
      GROUP BY status`).catch(() => ({ rows: [] }));
    res.json({
        probe_enabled: (0, outboundLinkHealth_1.outboundProbeEnabled)(),
        approx_total_products: Number(approxTotal.rows[0]?.total || '0'),
        approx_never_checked: Number(approxNeverChecked.rows[0]?.never_checked || '0'),
        sample_never_checked: Number(approxNeverChecked.rows[0]?.never_checked || '0'),
        due: {
            never_checked: approxNeverChecked.rows[0]?.never_checked || '0',
            stale_24h: 'approx_unavailable',
            fresh_24h: 'approx_unavailable',
            note: 'exact due counts disabled until idx_products_url_probe_due is valid (BUY-70938)',
        },
        probes_last_24h: recent.rows.reduce((acc, row) => {
            acc[row.status] = Number(row.count);
            return acc;
        }, {}),
        last_run_at: runSummary.rows[0]?.last_run_at || null,
        last_success_at: runSummary.rows[0]?.last_success_at || null,
        rows_checked_last_run: Number(rowsCheckedLastRun.rows[0]?.count || '0'),
    });
}
router.get('/v1/admin/probes/status', auth_1.adminOrMonitoringAuth, getProbesStatus);
// BUY-70988: root alias so Cart/monitoring can use the exact /admin/probes/status path.
router.get('/admin/probes/status', auth_1.adminOrMonitoringAuth, getProbesStatus);
// BUY-71331: per-URL probe history for Cart A2 reporting.
router.get('/v1/admin/probes/logs', auth_1.adminOrMonitoringAuth, getProbesLogs);
router.get('/admin/probes/logs', auth_1.adminOrMonitoringAuth, getProbesLogs);
exports.default = router;
