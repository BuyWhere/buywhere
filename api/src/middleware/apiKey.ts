import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { db, redis, FREE_TIER } from '../config';
import { sendError, sendRateLimitError, ErrorCode } from './errors';

const PAPERCLIP_API_URL = process.env.PAPERCLIP_API_URL || 'https://api.paperclip.ai';

const TIER_LIMITS: Record<string, { rpm: number; daily: number }> = {
  free: FREE_TIER,
  pro: { rpm: 300, daily: 10000 },
  enterprise: { rpm: 1000, daily: 100000 },
};

export function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

function base64UrlDecode(s: string): string {
  const base64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf8');
}

function isPaperclipJwtPayload(payload: Record<string, unknown>): boolean {
  return payload.iss === 'paperclip' && payload.aud === 'paperclip-api';
}

interface PaperclipAgentInfo {
  id: string;
  name: string;
  companyId?: string;
}

async function verifyPaperclipTokenWithApi(token: string): Promise<PaperclipAgentInfo | null> {
  try {
    const resp = await fetch(`${PAPERCLIP_API_URL}/api/agents/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (resp.status === 200) {
      const data = await resp.json() as PaperclipAgentInfo;
      if (data.id) return data;
    }
    return null;
  } catch {
    return null;
  }
}

async function resolvePaperclipAgentKey(agentId: string): Promise<{
  id: string;
  key_hash: string;
  name: string;
  tier: string;
  signup_channel: string | null;
  attribution_source: string | null;
} | null> {
  const result = await db.query(
    `SELECT id, key_hash, name, tier, signup_channel, attribution_source
     FROM api_keys
     WHERE signup_channel = 'paperclip_agent'
       AND name = $1
       AND is_active = true`,
    [agentId]
  );
  if (result.rows.length > 0) {
    const row = result.rows[0];
    db.query('UPDATE api_keys SET last_used_at = NOW() WHERE key_hash = $1', [row.key_hash]).catch(() => {});
    return row;
  }
  return null;
}

async function upsertPaperclipAgentKey(
  agentId: string,
  agentName: string,
  companyId?: string
): Promise<{
  id: string;
  key_hash: string;
  name: string;
  tier: string;
  signup_channel: string | null;
  attribution_source: string | null;
}> {
  const existing = await resolvePaperclipAgentKey(agentId);
  if (existing) return existing;

  const keyHash = hashKey(agentId);
  const result = await db.query(
    `INSERT INTO api_keys (key_hash, name, tier, signup_channel, developer_id, rpm_limit, daily_limit)
     VALUES ($1, $2, 'enterprise', 'paperclip_agent', $3, 1000, 100000)
     ON CONFLICT (key_hash) DO UPDATE SET last_used_at = NOW()
     RETURNING id, key_hash, name, tier, signup_channel, attribution_source`,
    [keyHash, agentName, companyId || null]
  );
  return result.rows[0];
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(base64UrlDecode(parts[1]));
  } catch {
    return null;
  }
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
    sendError(res, ErrorCode.MISSING_API_KEY);
    return;
  }

  // Detect Paperclip JWT — decode payload without signature verification
  const jwtPayload = decodeJwtPayload(key);
  if (jwtPayload && isPaperclipJwtPayload(jwtPayload)) {
    const agentInfo = await verifyPaperclipTokenWithApi(key);
    if (agentInfo) {
      const row = await upsertPaperclipAgentKey(agentInfo.id, agentInfo.name, agentInfo.companyId);
      req.apiKeyRecord = {
        id: row.id,
        key,
        agentName: row.name,
        tier: row.tier,
        rpmLimit: TIER_LIMITS.enterprise.rpm,
        dailyLimit: TIER_LIMITS.enterprise.daily,
        signupChannel: row.signup_channel,
        attributionSource: row.attribution_source,
      };
      next();
      return;
    }
    sendError(res, ErrorCode.INVALID_API_KEY, 'Invalid Paperclip token');
    return;
  }

  const keyHash = hashKey(key);
  const result = await db.query(
    `SELECT id, key_hash, name, tier, signup_channel, attribution_source, is_active
     FROM api_keys WHERE key_hash = $1`,
    [keyHash]
  );

  if (result.rows.length === 0) {
    sendError(res, ErrorCode.INVALID_API_KEY);
    return;
  }

  const row = result.rows[0];

  if (!row.is_active) {
    sendError(res, ErrorCode.REVOKED_API_KEY);
    return;
  }

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

  let rpmCount: number;
  let dailyCount: number;

  try {
    [rpmCount, dailyCount] = await Promise.all([
      redis.incr(rpmKey),
      redis.incr(dailyKey),
    ]);

    if (rpmCount === 1) redis.expire(rpmKey, 120).catch(() => {});
    if (dailyCount === 1) redis.expire(dailyKey, 172800).catch(() => {});
  } catch (_err) {
    console.warn('[rate-limit] Redis unavailable, skipping rate limit check');
    next();
    return;
  }

  if (rpmCount > req.apiKeyRecord.rpmLimit) {
    const retryAfter = Math.ceil(60 - (now % 60000) / 1000);
    sendRateLimitError(res, retryAfter, req.apiKeyRecord.rpmLimit, 0, 'Per-minute rate limit exceeded.');
    return;
  }

  if (dailyCount > req.apiKeyRecord.dailyLimit) {
    const retryAfter = Math.ceil(86400 - (now % 86400000) / 1000);
    sendRateLimitError(res, retryAfter, req.apiKeyRecord.dailyLimit, 0, 'Daily rate limit exceeded.');
    return;
  }

  next();
}
