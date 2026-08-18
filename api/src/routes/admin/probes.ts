import { Router, Request, Response } from 'express';
import { db } from '../../config';
import { outboundProbeEnabled } from '../../lib/outboundLinkHealth';
import { adminOrMonitoringAuth } from './auth';

const router = Router();

async function getProbesStatus(_req: Request, res: Response): Promise<void> {
  // BUY-70938: products has ~394M rows; full-table COUNT(*) seq-scans time out
  // when the url_probe_due index is invalid. Use approximate counts from pg_class
  // and pg_stats so the endpoint returns quickly regardless of index state.
  const approxTotal = await db.query<{ total: string }>(
    `SELECT reltuples::bigint AS total FROM pg_class WHERE relname = 'products'`
  ).catch(() => ({ rows: [{ total: '0' }] }));

  const approxNeverChecked = await db.query<{ never_checked: string }>(
    `SELECT ROUND(c.reltuples * COALESCE(s.null_frac, 0))::bigint AS never_checked
       FROM pg_class c
       LEFT JOIN pg_stats s ON s.schemaname = 'public'
                           AND s.tablename = 'products'
                           AND s.attname = 'url_last_checked_at'
      WHERE c.relname = 'products'`
  ).catch(() => ({ rows: [{ never_checked: '0' }] }));

  // BUY-71096: url_probe_log currently has no checked_at-leading index on prod.
  // Query only the trailing ~25h window so idx_url_probe_log_status_checked_at
  // keeps the endpoint fast even as the log grows.
  const runSummary = await db.query<{ last_run_at: string | null; last_success_at: string | null }>(
    `SELECT MAX(checked_at) FILTER (WHERE checked_at > NOW() - INTERVAL '25 hours') AS last_run_at,
            MAX(checked_at) FILTER (WHERE status = 'ok' AND checked_at > NOW() - INTERVAL '25 hours') AS last_success_at
       FROM url_probe_log`
  ).catch(() => ({ rows: [{ last_run_at: null, last_success_at: null }] }));

  const lastRunAt = runSummary.rows[0]?.last_run_at;
  const rowsCheckedLastRun = lastRunAt
    ? await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM url_probe_log
          WHERE checked_at > $1::timestamptz - INTERVAL '2 minutes'
            AND checked_at <= $1::timestamptz + INTERVAL '2 minutes'`,
        [lastRunAt]
      ).catch(() => ({ rows: [{ count: '0' }] }))
    : { rows: [{ count: '0' }] };

  const recent = await db.query<{ status: string; count: string }>(
    `SELECT status, COUNT(*)::text AS count
       FROM url_probe_log
      WHERE checked_at > NOW() - INTERVAL '24 hours'
      GROUP BY status`
  ).catch(() => ({ rows: [] as { status: string; count: string }[] }));

  res.json({
    probe_enabled: outboundProbeEnabled(),
    approx_total_products: Number(approxTotal.rows[0]?.total || '0'),
    approx_never_checked: Number(approxNeverChecked.rows[0]?.never_checked || '0'),
    sample_never_checked: Number(approxNeverChecked.rows[0]?.never_checked || '0'),
    due: {
      never_checked: approxNeverChecked.rows[0]?.never_checked || '0',
      stale_24h: 'approx_unavailable',
      fresh_24h: 'approx_unavailable',
      note: 'exact due counts disabled until idx_products_url_probe_due is valid (BUY-70938)',
    },
    probes_last_24h: recent.rows.reduce((acc: Record<string, number>, row: { status: string; count: string }) => {
      acc[row.status] = Number(row.count);
      return acc;
    }, {}),
    last_run_at: runSummary.rows[0]?.last_run_at || null,
    last_success_at: runSummary.rows[0]?.last_success_at || null,
    rows_checked_last_run: Number(rowsCheckedLastRun.rows[0]?.count || '0'),
  });
}

router.get('/v1/admin/probes/status', adminOrMonitoringAuth, getProbesStatus);

// BUY-70988: root alias so Cart/monitoring can use the exact /admin/probes/status path.
router.get('/admin/probes/status', adminOrMonitoringAuth, getProbesStatus);

export default router;
