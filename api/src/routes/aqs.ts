/**
 * AQS (Agent Quality Score) HTTP routes.
 *
 * Read-only endpoints over the `aqs_cycles` table that the
 * .github/workflows/aqs-ingest.yml scheduled job writes to via
 * scripts/aqs_calculator.py --store.
 *
 * Public endpoints (no auth) — AQS is a public-facing quality signal used
 * by agents, the marketing site, and the status page.
 */
import { Router, Request, Response } from 'express';
import { getCycleById, getHealth, getLatestCycle, listRecentCycles } from '../aqs/repository';

const router = Router();

/**
 * GET /v1/aqs/health — table presence + latest cycle metadata
 * Used by BUY-16518 to validate first scheduled run end-to-end.
 */
router.get('/health', async (_req: Request, res: Response) => {
  try {
    const health = await getHealth();
    const ready = health.table_present && health.last_cycle_at !== null;
    res.status(ready ? 200 : 503).json({
      data: health,
      meta: {
        ready,
        ts: new Date().toISOString(),
        source: 'aqs_cycles',
      },
    });
  } catch (err) {
    console.error('[aqs/health] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /v1/aqs/latest — most recent AQS cycle
 */
router.get('/latest', async (_req: Request, res: Response) => {
  try {
    const cycle = await getLatestCycle();
    if (!cycle) {
      return res.status(404).json({ error: 'no_aqs_cycles', message: 'No AQS cycles have been recorded yet' });
    }
    res.json({ data: cycle, meta: { ts: new Date().toISOString() } });
  } catch (err) {
    console.error('[aqs/latest] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /v1/aqs/cycles — recent AQS cycles (default 25, max 200)
 * Query: ?limit=N&market=sg  (market is currently a no-op, reserved)
 */
router.get('/cycles', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(String(req.query.limit ?? '25'), 10);
    const market = req.query.market ? String(req.query.market) : undefined;
    const cycles = await listRecentCycles(limit, market);
    res.json({
      data: cycles,
      meta: { count: cycles.length, ts: new Date().toISOString() },
    });
  } catch (err) {
    console.error('[aqs/cycles] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /v1/aqs/cycles/:cycle_id — single AQS cycle by its id
 */
router.get('/cycles/:cycle_id', async (req: Request, res: Response) => {
  try {
    const cycle = await getCycleById(req.params.cycle_id);
    if (!cycle) {
      return res.status(404).json({ error: 'not_found', message: `cycle_id ${req.params.cycle_id} not found` });
    }
    res.json({ data: cycle, meta: { ts: new Date().toISOString() } });
  } catch (err) {
    console.error('[aqs/cycles/:id] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
