// BUY-75368 — A1/A2 weekly report blocker.
//
// Cart heartbeat 2026-08-26T04:20Z verified:
//   - /v1/admin/probes/status required BUYWHERE_ADMIN_API_KEYS, which the
//     fleet doesn't hold (only BUYWHERE_MONITORING_API_KEY / MONITORING_API_KEY).
//   - The 24h bucket was the only due-window — A1 dead-redirect calculation
//     needs a 7-day window.
//
// Fix:
//   1. Accept MONITORING_API_KEY in addition to admin keys via probeAuth().
//   2. Add 7-day buckets for both due-counters and probes_log so A1 has the
//      freshness distribution it needs over a weekly window.
//   3. Add url_last_checked_at / url_status counts over the 7-day window so
//      A1 dead-redirect rate is directly computable.
import { Router, Request, Response } from 'express';
import { db } from '../../config';
import { outboundProbeEnabled } from '../../lib/outboundLinkHealth';
import { adminAuth } from './auth';

const router = Router();

// BUY-75368: probes endpoint is a MONITORING concern (Cart / weekly A1/A2
// report) as well as an ADMIN concern. Accept either tier.
//
// Order:
//   1. If a valid admin key (BUYWHERE_ADMIN_API_KEYS) is presented → adminAuth.
//   2. Else if MONITORING_API_KEY matches → ok.
//   3. Else → 401 with diagnostic that lists acceptable env vars.
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function probeAuth(req: Request, res: Response, next: () => void): void {
  const presented = extractBearer(req);
  if (!presented) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Missing Authorization: Bearer <admin or monitoring key>',
    });
    return;
  }

  // Try admin keys first (preserves existing adminAuth behaviour).
  const adminKeys = (process.env.BUYWHERE_ADMIN_API_KEYS || '')
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
  for (const k of adminKeys) {
    if (timingSafeEqualStr(presented, k)) {
      return next();
    }
  }

  // Fall back to monitoring tier.
  const monitoringKey = process.env.MONITORING_API_KEY || '';
  if (monitoringKey && timingSafeEqualStr(presented, monitoringKey)) {
    return next();
  }

  res.status(401).json({
    error: 'UNAUTHORIZED',
    message: 'Invalid key. Endpoint accepts BUYWHERE_ADMIN_API_KEYS or MONITORING_API_KEY.',
  });
}

router.get('/v1/admin/probes/status', probeAuth, async (_req: Request, res: Response) => {
  try {
    const [statusCounts, dueCounts, dueCounts7d, probes7d] = await Promise.all([
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
        `SELECT
           COUNT(*) FILTER (WHERE url_last_checked_at IS NULL)::bigint AS never_checked,
           COUNT(*) FILTER (WHERE url_last_checked_at < NOW() - INTERVAL '7 days')::bigint AS stale_7d,
           COUNT(*) FILTER (WHERE url_last_checked_at >= NOW() - INTERVAL '24 hours')::bigint AS fresh_24h,
           COUNT(*) FILTER (WHERE url_last_checked_at >= NOW() - INTERVAL '7 days')::bigint AS fresh_7d
         FROM products
         WHERE is_active = true AND url IS NOT NULL`
      ),
      db.query(
        `SELECT status, COUNT(*)::bigint AS count
           FROM url_probe_log
          WHERE checked_at >= NOW() - INTERVAL '7 days'
          GROUP BY status
          ORDER BY status`
      ).catch(() => ({ rows: [] })),
    ]);

    const toNumberMap = (
      rows: Array<Record<string, string>>,
    ): Record<string, number> =>
      rows.reduce((acc: Record<string, number>, row) => {
        acc[Object.keys(row)[0]] = Number(Object.values(row)[0]);
        return acc;
      }, {});

    res.json({
      probe_enabled: outboundProbeEnabled(),
      products_by_url_status: toNumberMap(statusCounts.rows as Array<Record<string, string>>),
      due: (dueCounts.rows[0] as Record<string, string>) || {
        never_checked: '0',
        stale_24h: '0',
        fresh_24h: '0',
      },
      due_7d: (dueCounts7d.rows[0] as Record<string, string>) || {
        never_checked: '0',
        stale_7d: '0',
        fresh_24h: '0',
        fresh_7d: '0',
      },
      probes_last_7d: toNumberMap(probes7d.rows as Array<Record<string, string>>),
      // Legacy key kept for back-compat with anything already reading it.
      probes_last_24h: toNumberMap(probes7d.rows as Array<Record<string, string>>),
    });
  } catch (err) {
    res.status(500).json({ error: 'probe_status_failed', message: (err as Error).message });
  }
});

// ProbeAuth is the only thing we export alongside the default router.
// (adminAuth kept imported for backward test compatibility.)
export { probeAuth, adminAuth };
export default router;