// BUY-55347 / BUY-52476 — admin trigger to force-refresh fx_rates
//
// Endpoint: POST /v1/admin/fx/refresh
// Auth: adminAuth middleware (BUYWHERE_ADMIN_API_KEYS)
//
// Runs the existing runFxRefresh() job inline. Returns the FxRefreshResult
// payload from the job. 200 on full success, 207 (Multi-Status) if any
// fallback path errored but partial data was upserted, 500 on unhandled.

import { Router, Request, Response } from 'express';
import { runFxRefresh } from '../../jobs/fxRefresh';
import { adminAuth } from './auth';

const router = Router();

router.post('/v1/admin/fx/refresh', adminAuth, async (_req: Request, res: Response) => {
  const startedAt = Date.now();
  try {
    const result = await runFxRefresh();
    res.status(result.success ? 200 : 207).json({
      ok: result.success,
      triggered_at: new Date(startedAt).toISOString(),
      rates_upserted: result.ratesUpserted,
      sources: result.sources,
      errors: result.errors,
      job_duration_ms: result.durationMs,
      total_duration_ms: Date.now() - startedAt,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      ok: false,
      triggered_at: new Date(startedAt).toISOString(),
      error: message,
    });
  }
});

export default router;
