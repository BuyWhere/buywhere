import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { db, redis, FREE_TIER } from '../config';

const TIER_LIMITS: Record<string, { rpm: number; daily: number }> = {
  free: FREE_TIER,
  pro: { rpm: 300, daily: 10000 },
  enterprise: { rpm: 1000, daily: 100000 },
};

function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

export async function requireApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers['authorization'] || '';
  const queryKey = req.query['api_key'] as string | undefined;

  let key: string | undefined;
  if (authHeader.startsWith('Bearer ')) {
    key = authHeader.slice(7).trim();
  } else if (authHeader.startsWith('ApiKey ')) {
    key = authHeader.slice(7).trim();
  } else if (queryKey) {
    key = queryKey;
  }

  if (!key) {
    res.status(401).json({ error: 'API key required. Pass as Authorization: Bearer <key>' });
    return;
  }

  const keyHash = hashKey(key);
  const result = await db.query(
    `SELECT id, key_hash, name, tier, signup_channel, attribution_source
     FROM api_keys WHERE key_hash = $1 AND is_active = 1`,
    [keyHash]
  );

  if (result.rows.length === 0) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  const row = result.rows[0];
  const tierLimits = TIER_LIMITS[row.tier] ?? FREE_TIER;
  req.apiKeyRecord = {
    id: row.id,
    key,
    agentName: row.name,
    tier: row.tier,
    rpmLimit: tierLimits.rpm,
    dailyLimit: tierLimits.daily,
    signupChannel: row.signup_channel,
    attributionSource: row.attribution_source,
  };

  // Update last_used_at (fire-and-forget)
  db.query('UPDATE api_keys SET last_used_at = NOW() WHERE key_hash = $1', [keyHash]).catch(() => {});

  next();
}

export async function checkRateLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.apiKeyRecord) {
    next();
    return;
  }

  const key = req.apiKeyRecord.key;
  const now = Date.now();
  const minuteWindow = Math.floor(now / 60000);
  const dayWindow = Math.floor(now / 86400000);

  const rpmKey = `rl:rpm:${key}:${minuteWindow}`;
  const dailyKey = `rl:daily:${key}:${dayWindow}`;

  const [rpmCount, dailyCount] = await Promise.all([
    redis.incr(rpmKey),
    redis.incr(dailyKey),
  ]);

  // Set TTL on first increment
  if (rpmCount === 1) redis.expire(rpmKey, 120).catch(() => {});
  if (dailyCount === 1) redis.expire(dailyKey, 172800).catch(() => {});

  if (rpmCount > req.apiKeyRecord.rpmLimit) {
    res.status(429).json({
      error: 'Rate limit exceeded',
      limit: req.apiKeyRecord.rpmLimit,
      window: 'per_minute',
      retry_after: 60 - (now % 60000) / 1000,
    });
    return;
  }

  if (dailyCount > req.apiKeyRecord.dailyLimit) {
    res.status(429).json({
      error: 'Daily limit exceeded',
      limit: req.apiKeyRecord.dailyLimit,
      window: 'per_day',
    });
    return;
  }

  next();
}
