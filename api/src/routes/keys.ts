import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { db } from '../config';
import { sendError, ErrorCode } from '../middleware/errors';

const router = Router();

function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

// POST /v1/keys — create a new API key
// Requires an admin API key passed as X-Admin-Key header or matching
// ADMIN_API_KEY env var. This is distinct from the public registration
// endpoint (/v1/auth/register) which requires email verification.
router.post('/', async (req: Request, res: Response) => {
  const adminKey = process.env.ADMIN_API_KEY;
  const providedKey = req.headers['x-admin-key'] as string | undefined;

  if (adminKey && providedKey !== adminKey) {
    sendError(res, ErrorCode.INVALID_API_KEY, 'Valid admin key required via X-Admin-Key header');
    return;
  }

  const { name, email, tier, rpm_limit, daily_limit, is_test } = req.body;

  if (!name || typeof name !== 'string') {
    sendError(res, ErrorCode.INVALID_PARAMETER, 'name is required');
    return;
  }

  const rawKey = `bw_${uuidv4().replace(/-/g, '')}`;
  const keyHash = hashKey(rawKey);

  const resolvedTier = typeof tier === 'string' ? tier : 'free';
  const resolvedRpm = typeof rpm_limit === 'number' ? rpm_limit : 60;
  const resolvedDaily = typeof daily_limit === 'number' ? daily_limit : 1000;

  try {
    await db.query(
      `INSERT INTO api_keys
         (id, key_hash, name, email, tier, is_active, rpm_limit, daily_limit, signup_channel, is_test)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, true, $5, $6, 'api_key_endpoint', $7)`,
      [keyHash, name.trim().slice(0, 200), email ? String(email).slice(0, 500) : null, resolvedTier, resolvedRpm, resolvedDaily, is_test === true]
    );

    res.status(201).json({
      api_key: rawKey,
      tier: resolvedTier,
      name: name.trim().slice(0, 200),
      rate_limit: { rpm: resolvedRpm, daily: resolvedDaily },
    });
  } catch (err) {
    console.error('[keys] create error:', err);
    sendError(res, ErrorCode.INTERNAL_ERROR);
  }
});

export default router;
