import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { db, redis, FREE_TIER, TIER_LIMITS } from '../config';
import { sendError, ErrorCode } from './errors';
import { sendSpecError, sendDailyLimitError, sendPerMinuteLimitError } from './errors';

const PAPERCLIP_API_URL_FALLBACKS = ['https://api.paperclip.ai', 'https://paperclip.richteo.com'];
const PAPERCLIP_API_URLS = [...new Set([
  ...(process.env.PAPERCLIP_API_URL || '').split(',').map((v) => v.trim()).filter(Boolean),
  ...PAPERCLIP_API_URL_FALLBACKS,
])];
const JWT_CACHE_TTL_SECONDS = 300;

export function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

function apiKeyLookupHashes(rawKey: string): string[] {
  const hashes = [hashKey(rawKey)];
  if (rawKey.startsWith('bw_beta_')) {
    hashes.push(hashKey(`bw_${rawKey.slice('bw_beta_'.length)}`));
  }
  return [...new Set(hashes)];
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

function jwtCacheKey(token: string): string {
  return `jwt:verify:${createHash('sha256').update(token).digest('hex')}`;
}

async function getCachedJwtVerification(token: string): Promise<PaperclipAgentInfo | null> {
  try {
    const cached = await redis.get(jwtCacheKey(token));
    if (cached) return JSON.parse(cached) as PaperclipAgentInfo;
  } catch {
  }
  return null;
}

async function setCachedJwtVerification(token: string, info: PaperclipAgentInfo): Promise<void> {
  try {
    await redis.set(jwtCacheKey(token), JSON.stringify(info), 'EX', JWT_CACHE_TTL_SECONDS);
  } catch {
  }
}

async function verifyPaperclipTokenAtUrl(token: string, baseUrl: string, agentPath: string): Promise<PaperclipAgentInfo | null> {
  const url = new URL(`${baseUrl}${agentPath}`);
  const isHttps = url.protocol === 'https:';
  const requestFn = isHttps ? httpsRequest : httpRequest;

  return new Promise<PaperclipAgentInfo | null>((resolve) => {
    const connectTimeout = 2000;
    const headersTimeout = 3000;
    let settled = false;

    const req = requestFn(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on('end', () => {
          if (settled) return;
          settled = true;
          if (res.statusCode === 200) {
            try {
              const data = JSON.parse(body) as PaperclipAgentInfo;
              if (data.id) {
                resolve(data);
                return;
              }
            } catch {}
          }
          resolve(null);
        });
      },
    );

    req.on('socket', (socket) => {
      socket.setTimeout(connectTimeout, () => {
        if (!settled) {
          settled = true;
          req.destroy(new Error('socket timeout'));
          resolve(null);
        }
      });
    });

    req.on('error', () => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    });

    req.setTimeout(headersTimeout, () => {
      if (!settled) {
        settled = true;
        req.destroy(new Error('headers timeout'));
        resolve(null);
      }
    });

    req.end();
  });
}

async function verifyPaperclipTokenWithApi(token: string): Promise<PaperclipAgentInfo | null> {
  const agentPaths = ['/api/agents/me', '/agents/me'];
  for (const baseUrl of PAPERCLIP_API_URLS) {
    for (const agentPath of agentPaths) {
      try {
        const result = await verifyPaperclipTokenAtUrl(token, baseUrl, agentPath);
        if (result) return result;
      } catch {
        // try next
      }
    }
  }
  return null;
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

function nextMidnightUTC(): Date {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d;
}

function tierDailyLimit(tier: string, rowDailyLimit: number | null): number {
  if (rowDailyLimit != null && rowDailyLimit > 0) return rowDailyLimit;
  return (TIER_LIMITS[tier] ?? FREE_TIER).daily;
}

function tierRpmLimit(tier: string, rowRpmLimit: number | null): number {
  if (rowRpmLimit != null && rowRpmLimit > 0) return rowRpmLimit;
  return (TIER_LIMITS[tier] ?? FREE_TIER).rpm;
}

export async function requireApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers['authorization'] || '';
  const xApiKey = req.headers['x-api-key'] as string | undefined;
  const queryKey = req.query['api_key'] as string | undefined;

  let key: string | undefined;
  if (authHeader.startsWith('Bearer ')) {
    key = authHeader.slice(7).trim();
  } else if (authHeader.startsWith('ApiKey ')) {
    key = authHeader.slice(7).trim();
  } else if (xApiKey) {
    key = xApiKey.trim();
  } else if (queryKey) {
    key = queryKey;
  }

  if (!key) {
    sendSpecError(res, 'missing_api_key', 'API key required. Get one at https://buywhere.ai/dashboard', 401);
    return;
  }

  const jwtPayload = decodeJwtPayload(key);
  if (jwtPayload && isPaperclipJwtPayload(jwtPayload)) {
    let agentInfo = await getCachedJwtVerification(key);
    if (!agentInfo) {
      agentInfo = await verifyPaperclipTokenWithApi(key);
      if (agentInfo) {
        await setCachedJwtVerification(key, agentInfo);
      }
    }
    if (agentInfo) {
      try {
        const row = await upsertPaperclipAgentKey(agentInfo.id, agentInfo.name, agentInfo.companyId);
        const limits = TIER_LIMITS[row.tier] ?? TIER_LIMITS.enterprise;
        req.apiKeyRecord = {
          id: row.id,
          key,
          agentName: row.name,
          tier: row.tier,
          rpmLimit: limits.rpm,
          dailyLimit: limits.daily,
          signupChannel: row.signup_channel,
          attributionSource: row.attribution_source,
          dailyRequestCount: 0,
          dailyResetAt: nextMidnightUTC(),
        };
        next();
        return;
      } catch (err) {
        console.error('[auth] upsertPaperclipAgentKey failed:', err);
        sendError(res, ErrorCode.INTERNAL_ERROR, 'Auth key setup failed');
        return;
      }
    }
    sendSpecError(res, 'invalid_api_key', 'Invalid Paperclip token', 401);
    return;
  }

  const keyHashes = apiKeyLookupHashes(key);
  const result = await db.query(
    `SELECT id, key_hash, name, tier, signup_channel, attribution_source, is_active,
            daily_request_count, daily_reset_at, rpm_limit, daily_limit
     FROM api_keys WHERE key_hash = ANY($1::text[])`,
    [keyHashes]
  );

  if (result.rows.length === 0) {
    sendSpecError(res, 'invalid_api_key', undefined, 401);
    return;
  }

  const row = result.rows[0];

  if (!row.is_active) {
    sendSpecError(res, 'invalid_api_key', 'API key has been revoked', 401);
    return;
  }

  const dailyLimit = tierDailyLimit(row.tier, row.daily_limit);
  const rpmLimit = tierRpmLimit(row.tier, row.rpm_limit);

  let dailyRequestCount = row.daily_request_count || 0;
  let dailyResetAt = row.daily_reset_at ? new Date(row.daily_reset_at) : nextMidnightUTC();
  const now = new Date();

  if (now >= dailyResetAt) {
    dailyRequestCount = 0;
    dailyResetAt = nextMidnightUTC();
    db.query(
      'UPDATE api_keys SET daily_request_count = 0, daily_reset_at = $1 WHERE id = $2',
      [dailyResetAt, row.id]
    ).catch(() => {});
  }

  if (dailyRequestCount >= dailyLimit) {
    sendDailyLimitError(res, row.tier, dailyLimit, dailyResetAt.toISOString());
    return;
  }

  req.apiKeyRecord = {
    id: row.id,
    key,
    agentName: row.name,
    tier: row.tier,
    rpmLimit,
    dailyLimit,
    signupChannel: row.signup_channel,
    attributionSource: row.attribution_source,
    dailyRequestCount,
    dailyResetAt,
  };

  res.set('X-RateLimit-Limit-Day', String(dailyLimit));
  res.set('X-RateLimit-Remaining-Day', String(Math.max(0, dailyLimit - dailyRequestCount - 1)));

  db.query(
    'UPDATE api_keys SET daily_request_count = daily_request_count + 1, last_used_at = NOW() WHERE id = $1',
    [row.id]
  ).catch(() => {});

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

  const rpmKey = `rl:rpm:${key}:${minuteWindow}`;

  let rpmCount: number;

  try {
    rpmCount = await redis.incr(rpmKey);
    if (rpmCount === 1) redis.expire(rpmKey, 120).catch(() => {});
  } catch (_err) {
    console.warn('[rate-limit] Redis unavailable, skipping rate limit check');
    next();
    return;
  }

  if (rpmCount > req.apiKeyRecord.rpmLimit) {
    sendPerMinuteLimitError(res, req.apiKeyRecord.tier, req.apiKeyRecord.rpmLimit);
    return;
  }

  next();
}
