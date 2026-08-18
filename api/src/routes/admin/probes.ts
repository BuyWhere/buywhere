import { Router, Request, Response } from 'express';
import { db } from '../../config';
import { outboundProbeEnabled } from '../../lib/outboundLinkHealth';
import { adminOrMonitoringAuth } from './auth';

const router = Router();

const DEFAULT_LOG_LIMIT = 100;
const MAX_LOG_LIMIT = 1000;

type ProbeLogRow = {
  id: string;
  product_id: string;
  merchant_id: string | null;
  url: string;
  status: string;
  reason: string | null;
  response_code: number | null;
  checked_at: string;
  latency_ms: number | null;
};

function parsePagination(req: Request): {
  limit: number;
  offset: number;
  cursorCheckedAt: string | null;
  cursorId: string | null;
  status: string | null;
  productId: string | null;
  since: string | null;
  until: string | null;
} {
  const rawLimit = parseInt((req.query.limit as string) || `${DEFAULT_LOG_LIMIT}`, 10);
  const limit = Number.isNaN(rawLimit) ? DEFAULT_LOG_LIMIT : Math.min(Math.max(rawLimit, 1), MAX_LOG_LIMIT);

  const rawOffset = parseInt((req.query.offset as string) || '0', 10);
  const offset = Number.isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

  const cursor = (req.query.cursor as string) || '';
  let cursorCheckedAt: string | null = null;
  let cursorId: string | null = null;
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
    status: (req.query.status as string) || null,
    productId: (req.query.product_id as string) || null,
    since: (req.query.since as string) || null,
    until: (req.query.until as string) || null,
  };
}

async function getProbesLogs(req: Request, res: Response): Promise<void> {
  const { limit, offset, cursorCheckedAt, cursorId, status, productId, since, until } = parsePagination(req);

  const whereClauses: string[] = [];
  const params: (string | number)[] = [];
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
      db.query<ProbeLogRow>(rowsSql, params),
      db.query<{ total: string }>(countSql, params.slice(0, -2)), // exclude limit/offset from count
    ]);

    const rows = rowsResult.rows;
    const total = Number(countResult.rows[0]?.total || '0');

    const lastRow = rows[rows.length - 1];
    const nextCursor = lastRow ? `${lastRow.checked_at}:${lastRow.id}` : null;

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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'QUERY_FAILED', message });
  }
}

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

// BUY-71331: per-URL probe history for Cart A2 reporting.
router.get('/v1/admin/probes/logs', adminOrMonitoringAuth, getProbesLogs);
router.get('/admin/probes/logs', adminOrMonitoringAuth, getProbesLogs);

export default router;
