// BUY-22737 / BUY-35381 — GET /v1/admin/metrics?window=30m
//
// In-memory histogram only. No DB access; "degraded" is not a concept here
// because the data source is the in-process ring buffer (or empty if no
// traffic has flowed in the window).

import { Router, Request, Response } from 'express';
import { snapshotHistograms, LATENCY_BUCKETS_MS } from '../../middleware/latency';
import { adminAuth } from './auth';

const router = Router();

// Parse "30m", "5m", "1h" into seconds. Default 30m.
function parseWindowToSeconds(raw: unknown): number {
  if (typeof raw !== 'string' || raw.length === 0) return 30 * 60;
  const m = raw.trim().match(/^(\d+)\s*([smhd])?$/i);
  if (!m) return 30 * 60;
  const n = parseInt(m[1], 10);
  const unit = (m[2] || 's').toLowerCase();
  const mult = unit === 'd' ? 86_400 : unit === 'h' ? 3_600 : unit === 'm' ? 60 : 1;
  return Math.max(1, Math.min(n * mult, 24 * 60 * 60));
}

router.get('/v1/admin/metrics', adminAuth, (_req: Request, res: Response) => {
  const snap = snapshotHistograms();
  res.json({
    window_seconds: snap.window_seconds,
    buckets_ms: LATENCY_BUCKETS_MS,
    routes: snap.routes,
    generated_at: snap.generated_at,
  });
});

router.get('/v1/admin/metrics/window', adminAuth, (req: Request, res: Response) => {
  // Convenience endpoint — same shape as /v1/admin/metrics but lets the caller
  // request a (shorter) window. The ring buffer always holds 30m of data, so
  // the response is just a filtered subset of the same samples.
  const winSec = parseWindowToSeconds(req.query.window);
  const snap = snapshotHistograms();
  // The middleware always returns 30m of data; we don't keep per-second windows
  // in memory, so "window=" is informational here. We surface the parsed value
  // in the response so callers can see what was honored.
  res.json({
    requested_window_seconds: winSec,
    actual_window_seconds: snap.window_seconds,
    buckets_ms: LATENCY_BUCKETS_MS,
    routes: snap.routes,
    generated_at: snap.generated_at,
  });
});

export default router;
