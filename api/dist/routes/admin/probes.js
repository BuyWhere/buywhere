"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const config_1 = require("../../config");
const outboundLinkHealth_1 = require("../../lib/outboundLinkHealth");
const auth_1 = require("./auth");
const router = (0, express_1.Router)();
async function getProbesStatus(_req, res) {
    // BUY-70938: products has ~394M rows; full-table COUNT(*) seq-scans time out
    // when the url_probe_due index is invalid. Use approximate counts from pg_class
    // and pg_stats, plus a bounded primary-key scan for never-checked rows, so the
    // endpoint returns in <1s regardless of index state.
    const approxTotal = await config_1.db.query(`SELECT reltuples::bigint AS total FROM pg_class WHERE relname = 'products'`).catch(() => ({ rows: [{ total: '0' }] }));
    const approxNeverChecked = await config_1.db.query(`SELECT ROUND(c.reltuples * COALESCE(s.null_frac, 0))::bigint AS never_checked
       FROM pg_class c
       LEFT JOIN pg_stats s ON s.schemaname = 'public'
                           AND s.tablename = 'products'
                           AND s.attname = 'url_last_checked_at'
      WHERE c.relname = 'products'`).catch(() => ({ rows: [{ never_checked: '0' }] }));
    const neverCheckedSample = await config_1.db.query(`SET LOCAL statement_timeout = '3000';
     SELECT COUNT(*)::bigint AS count
       FROM products
      WHERE is_active = true
        AND url IS NOT NULL
        AND url_last_checked_at IS NULL
      LIMIT 5000`).catch(() => ({ rows: [{ count: '0' }] }));
    const recent = await config_1.db.query(`SELECT status, COUNT(*)::bigint AS count
       FROM url_probe_log
      WHERE checked_at >= NOW() - INTERVAL '24 hours'
      GROUP BY status
      ORDER BY status`).catch(() => ({ rows: [] }));
    // BUY-70988: Cart needs precise last-run telemetry for the Sev-2 drift router
    // and weekly A1/A2 reports. Derive run boundaries from url_probe_log so no
    // separate runs table is required.
    const runSummary = await config_1.db.query(`SET LOCAL statement_timeout = '3000';
     SELECT MAX(checked_at) AS last_run_at,
            MAX(checked_at) FILTER (WHERE status = 'ok') AS last_success_at
       FROM url_probe_log`).catch(() => ({ rows: [{ last_run_at: null, last_success_at: null }] }));
    const lastRunAt = runSummary.rows[0]?.last_run_at || null;
    const rowsCheckedLastRun = lastRunAt
        ? await config_1.db.query(`SET LOCAL statement_timeout = '3000';
         SELECT COUNT(*)::bigint AS count
           FROM url_probe_log
          WHERE checked_at >= ($1::timestamptz - INTERVAL '2 minutes')
            AND checked_at <= ($1::timestamptz + INTERVAL '2 minutes')`, [lastRunAt]).catch(() => ({ rows: [{ count: '0' }] }))
        : { rows: [{ count: '0' }] };
    res.json({
        probe_enabled: (0, outboundLinkHealth_1.outboundProbeEnabled)(),
        approx_total_products: Number(approxTotal.rows[0]?.total || '0'),
        approx_never_checked: Number(approxNeverChecked.rows[0]?.never_checked || '0'),
        sample_never_checked: Number(neverCheckedSample.rows[0]?.count || '0'),
        due: {
            never_checked: neverCheckedSample.rows[0]?.count || '0',
            stale_24h: 'approx_unavailable',
            fresh_24h: 'approx_unavailable',
            note: 'exact due counts disabled until idx_products_url_probe_due is valid (BUY-70938)',
        },
        probes_last_24h: recent.rows.reduce((acc, row) => {
            acc[row.status] = Number(row.count);
            return acc;
        }, {}),
        last_run_at: lastRunAt,
        last_success_at: runSummary.rows[0]?.last_success_at || null,
        rows_checked_last_run: Number(rowsCheckedLastRun.rows[0]?.count || '0'),
    });
}
router.get('/v1/admin/probes/status', auth_1.adminAuth, getProbesStatus);
// BUY-70988: root alias so Cart/monitoring can use the exact /admin/probes/status path.
router.get('/admin/probes/status', auth_1.adminAuth, getProbesStatus);
exports.default = router;
