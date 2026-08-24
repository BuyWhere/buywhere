import { Router, Request, Response } from 'express';
import { db } from '../../config';
import { outboundProbeEnabled } from '../../lib/outboundLinkHealth';
import { adminAuth } from './auth';

const router = Router();

router.get('/v1/admin/probes/status', adminAuth, async (_req: Request, res: Response) => {
  try {
    const [statusCounts, dueCounts, recent] = await Promise.all([
      db.query(
        `SELECT COALESCE(url_status, 'ok') AS status, COUNT(*)::bigint AS count
           FROM products
          WHERE url IS NOT NULL
          GROUP BY COALESCE(url_status, 'ok')
          ORDER BY status`
      ),
      db.query(
        `SELECT
           COUNT(*) FILTER (WHERE url_last_checked_at IS NULL)::bigint AS never_checked,
           COUNT(*) FILTER (WHERE url_last_checked_at < NOW() - INTERVAL '24 hours')::bigint AS stale_24h,
           COUNT(*) FILTER (WHERE url_last_checked_at >= NOW() - INTERVAL '24 hours')::bigint AS fresh_24h
         FROM products
         WHERE is_active = true AND url IS NOT NULL`
      ),
      db.query(
        `SELECT status, COUNT(*)::bigint AS count
           FROM url_probe_log
          WHERE checked_at >= NOW() - INTERVAL '24 hours'
          GROUP BY status
          ORDER BY status`
      ).catch(() => ({ rows: [] })),
    ]);

    res.json({
      probe_enabled: outboundProbeEnabled(),
      products_by_url_status: statusCounts.rows.reduce((acc: Record<string, number>, row: { status: string; count: string }) => {
        acc[row.status] = Number(row.count);
        return acc;
      }, {}),
      due: dueCounts.rows[0] || { never_checked: '0', stale_24h: '0', fresh_24h: '0' },
      probes_last_24h: recent.rows.reduce((acc: Record<string, number>, row: { status: string; count: string }) => {
        acc[row.status] = Number(row.count);
        return acc;
      }, {}),
    });
  } catch (err) {
    res.status(500).json({ error: 'probe_status_failed', message: (err as Error).message });
  }
});

export default router;
