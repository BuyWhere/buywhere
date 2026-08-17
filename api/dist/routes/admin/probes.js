"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const config_1 = require("../../config");
const outboundLinkHealth_1 = require("../../lib/outboundLinkHealth");
const auth_1 = require("./auth");
const router = (0, express_1.Router)();
router.get('/v1/admin/probes/status', auth_1.adminAuth, async (_req, res) => {
    // products has ~308M rows; the status-counts aggregate scans the whole table.
    // Use a short statement timeout so the admin endpoint stays snappy and falls
    // back to partial results if the aggregate exceeds budget.
    const statusCounts = await config_1.db.query(`SET LOCAL statement_timeout = '3000';
     SELECT COALESCE(url_status, 'ok') AS status, COUNT(*)::bigint AS count
       FROM products
      WHERE url IS NOT NULL
      GROUP BY COALESCE(url_status, 'ok')
      ORDER BY status`).catch(() => ({ rows: [] }));
    const dueCounts = await config_1.db.query(`SET LOCAL statement_timeout = '3000';
     SELECT
       COUNT(*) FILTER (WHERE url_last_checked_at IS NULL)::bigint AS never_checked,
       COUNT(*) FILTER (WHERE url_last_checked_at < NOW() - INTERVAL '24 hours')::bigint AS stale_24h,
       COUNT(*) FILTER (WHERE url_last_checked_at >= NOW() - INTERVAL '24 hours')::bigint AS fresh_24h
     FROM products
     WHERE is_active = true AND url IS NOT NULL`).catch(() => ({ rows: [{ never_checked: '0', stale_24h: '0', fresh_24h: '0' }] }));
    const recent = await config_1.db.query(`SELECT status, COUNT(*)::bigint AS count
       FROM url_probe_log
      WHERE checked_at >= NOW() - INTERVAL '24 hours'
      GROUP BY status
      ORDER BY status`).catch(() => ({ rows: [] }));
    res.json({
        probe_enabled: (0, outboundLinkHealth_1.outboundProbeEnabled)(),
        products_by_url_status: statusCounts.rows.reduce((acc, row) => {
            acc[row.status] = Number(row.count);
            return acc;
        }, {}),
        due: dueCounts.rows[0] || { never_checked: '0', stale_24h: '0', fresh_24h: '0' },
        probes_last_24h: recent.rows.reduce((acc, row) => {
            acc[row.status] = Number(row.count);
            return acc;
        }, {}),
    });
});
exports.default = router;
