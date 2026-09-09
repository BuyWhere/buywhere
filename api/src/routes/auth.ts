import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { createHash, randomBytes } from 'crypto';
import { db, FREE_TIER, TIER_LIMITS, redis, API_BASE_URL } from '../config';
import { requireApiKey } from '../middleware/apiKey';
import { trackRegistration, trackEmailVerified } from '../analytics/posthog';
import { sendVerificationEmail } from '../email';
import { sendError } from '../middleware/errors';
import { ErrorCode } from '../middleware/errors';

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

function generateVerificationToken(): string {
  return randomBytes(32).toString('hex');
}

// POST /v1/auth/register
// POST /v1/developers/signup
// Headless agent self-registration — requires email for verification
// BUY-72774: verify=false query param skips email verification and issues pending-verify tier
async function registerAgent(req: Request, res: Response): Promise<void> {
  const { agent_name, email, contact, use_case, is_internal: reqIsInternal } = req.body;
  // BUY-72774: verify=false → issue pending-verify tier, skip verification email
  const skipVerify = req.query.verify === 'false';

  if (!agent_name || typeof agent_name !== 'string') {
    res.status(400).json({ error: 'agent_name is required' });
    return;
  }

  // BUY-72823: internal-flag registration — only honored when the caller
  // presents the shared BUYWHERE_SIGNUP_SECRET header. Without the secret,
  // any "is_internal" in the body is silently ignored (column default = false).
  // This lets fleet-testing harnesses mint keys invisible to growth cohorts
  // without exposing the flag to arbitrary public signups.
  const headerSecret = req.headers['x-buywhere-signup-secret'];
  const envSecret = process.env.BUYWHERE_SIGNUP_SECRET;
  const isInternal = !!(
    reqIsInternal === true &&
    envSecret &&
    typeof headerSecret === 'string' &&
    headerSecret === envSecret
  );

  const emailAddr = (email || contact || '') as string;
  const hasEmail = emailAddr.length > 0;
  // Email is OPTIONAL for agent self-service (MCP/API are agent-only; no human signup required).
  // If provided it must be valid (enables tier upgrade via verification); if omitted, an unverified key is issued directly.
  if (hasEmail && !EMAIL_RE.test(emailAddr)) {
    sendError(res, ErrorCode.INVALID_PARAMETER, 'If an email is provided, it must be valid.');
    return;
  }

  // Generate API key (raw key returned once, only hash stored)
  const rawKey = `bw_${uuidv4().replace(/-/g, '')}`;
  const keyHash = hashKey(rawKey);

  // UTM / attribution from query params or body
  const utmSource = (req.query.utm_source || req.body.utm_source) as string | undefined;
  const utmMedium = (req.query.utm_medium || req.body.utm_medium) as string | undefined;
  // GTM-attribution (2026-08-22): persist the FULL utm set + a referrer-host
  // fallback — the columns existed but were never written, leaving attribution
  // blind (100% 'direct' in the W1 growth analysis).
  const utmCampaign = (req.query.utm_campaign || req.body.utm_campaign) as string | undefined;
  const utmContent = (req.query.utm_content || req.body.utm_content) as string | undefined;
  const utmTerm = (req.query.utm_term || req.body.utm_term) as string | undefined;
  const clip = (v: string | undefined) => (v ? String(v).slice(0, 200) : null);
  let referrerHost: string | null = null;
  try {
    const ref = req.headers['referer'];
    if (typeof ref === 'string' && ref) referrerHost = new URL(ref).hostname.slice(0, 200);
  } catch { /* malformed referer — ignore */ }
  const signupChannel = resolveSignupChannel(req.headers['referer'], utmSource, utmMedium);

  // BUY-72774: determine tier based on verify=false flag
  const tier = skipVerify ? 'pending_verify' : 'unverified';
  // Capture registration IP for anti-abuse (pending-verify tier)
  const clientIp =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ??
    (req.headers['x-real-ip'] as string) ??
    (req as any).ip ??
    null;
  const verificationToken: string | null = hasEmail && !skipVerify ? generateVerificationToken() : null;
  const expiresAt: string | null = hasEmail && !skipVerify ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : null;
  const id = uuidv4();

  // BUY-72774: for pending-verify tier, capture IP for tracking.
  // Anti-abuse IP limit (3+ keys/24h) is enforced in the apiKey middleware
  // on first use, not at registration — keeping the register path synchronous.
  const registrationIp = skipVerify ? clientIp : null;

  await db.query(
    `INSERT INTO api_keys
       (id, key_hash, name, email, contact, use_case, tier, is_active,
        signup_channel, attribution_source, developer_id,
        email_verification_token, email_verification_expires_at,
        registration_ip, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        is_internal)
      VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9,'self-registered',$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [
      id,
      keyHash,
      agent_name.trim().slice(0, 200),
      hasEmail ? emailAddr.slice(0, 500) : null,
      hasEmail ? emailAddr.slice(0, 500) : null,
      use_case ? String(use_case).slice(0, 1000) : null,
      tier,
      signupChannel,
      utmSource || referrerHost || null,
      verificationToken,
      expiresAt,
      registrationIp,
      clip(utmSource),
      clip(utmMedium),
      clip(utmCampaign),
      clip(utmContent),
      clip(utmTerm),
      isInternal,
    ]
  );

  // BUY-72774: background IP counter — fire-and-forget, non-blocking.
  // Updates api_keys.keys_from_same_ip_24h for future use-time checks.
  if (skipVerify && clientIp) {
    const ipHash = createHash('sha256').update(clientIp).digest('hex').slice(0, 32);
    const ipCounterKey = `auth:pending_verify:ip:${ipHash}`;
    db.query(
      `UPDATE api_keys SET keys_from_same_ip_24h = (
         SELECT COUNT(*) FROM api_keys
         WHERE registration_ip = $1 AND created_at > NOW() - INTERVAL '24 hours'
       ) WHERE id = $2`,
      [clientIp, id]
    ).catch(() => {});
    // Increment Redis for use-time fast-path check (best-effort, never blocks)
    redis.incr(ipCounterKey).catch(() => {});
    redis.expire(ipCounterKey, 24 * 60 * 60).catch(() => {});
  }

  // Fire PostHog registration event (async, non-blocking)
  trackRegistration(hashKey(rawKey), agent_name, signupChannel, utmSource || null);

  // Send verification email only when an email was supplied (optional for agents)
  // BUY-72774: skip email when verify=false (pending-verify tier has no email)
  if (hasEmail && verificationToken && !skipVerify) {
    sendVerificationEmail(emailAddr, verificationToken)
      .then((sent) => {
        if (sent) {
          db.query(
            `UPDATE api_keys SET email_verification_sent_at = NOW() WHERE key_hash = $1`,
            [keyHash]
          ).catch(() => {});
        }
      })
      .catch(() => {});
  }

  // BUY-72775: include verify_url in response when email provided — enables
  // one-step paste of both api_key and verify_url into framework config.
  // BUY-72774: verify=false path has no email verification.
  const pvLimits = TIER_LIMITS.pending_verify;
  const response: Record<string, unknown> = {
    api_key: rawKey,
    tier: skipVerify ? 'pending-verify' : 'unverified',
    email_verified: false,
    rate_limit: {
      rpm: skipVerify ? pvLimits.rpm : TIER_LIMITS.unverified.rpm,
      daily: skipVerify ? pvLimits.daily : TIER_LIMITS.unverified.daily,
      ...(skipVerify ? { week: pvLimits.weekly } : {}),
    },
    ...(skipVerify ? { cap: { day: pvLimits.daily, wk: pvLimits.weekly } } : {}),
    docs: 'https://api.buywhere.ai/docs',
  };

  if (hasEmail && verificationToken) {
    response.verify_url = `${API_BASE_URL}/v1/auth/verify?token=${encodeURIComponent(verificationToken)}`;
  }

  res.status(201).json(response);
}

router.post('/register', registerAgent);
router.post('/signup', registerAgent);

// GET /v1/auth/verify?token=xxx
router.get('/verify', async (req: Request, res: Response) => {
  const { token } = req.query;

  if (!token || typeof token !== 'string') {
    sendError(res, ErrorCode.INVALID_PARAMETER, 'Verification token is required.');
    return;
  }

  // BUY-72774: check current tier to determine promotion target
  // pending_verify -> free (via email verification), unverified -> verified_agent
  const currentTierResult = await db.query(
    `SELECT tier FROM api_keys
     WHERE email_verification_token = $1
       AND email_verified = false
       AND (email_verification_expires_at IS NULL OR email_verification_expires_at > NOW())`,
    [token]
  );

  const newTier = currentTierResult.rows[0]?.tier === 'pending_verify' ? 'free' : 'verified_agent';

  const result = await db.query(
    `UPDATE api_keys
       SET email_verified = true,
           email_verification_token = NULL,
           email_verification_expires_at = NULL,
           tier = $2
     WHERE email_verification_token = $1
       AND email_verified = false
       AND (email_verification_expires_at IS NULL OR email_verification_expires_at > NOW())
     RETURNING id, email, tier, rpm_limit, daily_limit`,
    [token, newTier]
  );

  if (result.rows.length === 0) {
    // Check if token exists but expired
    const expired = await db.query(
      `SELECT id FROM api_keys
       WHERE email_verification_token = $1
         AND email_verified = false
         AND email_verification_expires_at <= NOW()`,
      [token]
    );
    if (expired.rows.length > 0) {
      sendError(res, ErrorCode.INVALID_PARAMETER, 'Verification token has expired. Request a new one.', undefined, 410);
      return;
    }
    sendError(res, ErrorCode.INVALID_PARAMETER, 'Verification token is invalid or already used.', undefined, 404);
    return;
  }

  const { id, email: verifiedEmail, tier, rpm_limit, daily_limit } = result.rows[0];
  const effectiveDaily = daily_limit ?? (TIER_LIMITS[tier] ?? FREE_TIER).daily;
  const effectiveRpm = rpm_limit ?? (TIER_LIMITS[tier] ?? FREE_TIER).rpm;

  trackEmailVerified(id, verifiedEmail);

  res.json({
    message: 'Email verified successfully.',
    tier,
    rate_limit: {
      rpm: effectiveRpm,
      daily: effectiveDaily,
    },
  });
});

// POST /v1/auth/resend-verification
router.post('/resend-verification', async (req: Request, res: Response) => {
  const { email } = req.body;

  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email)) {
    sendError(res, ErrorCode.INVALID_PARAMETER, 'A valid email address is required.');
    return;
  }

  const normalizedEmail = email.trim().toLowerCase().slice(0, 500);

  // Rate limit: 1 resend per 60s per email
  const rateLimitKey = `verify:resend:${normalizedEmail}`;
  const lastSent = await redis.get(rateLimitKey);
  if (lastSent) {
    const ttl = await redis.ttl(rateLimitKey);
    sendError(res, ErrorCode.RATE_LIMIT_EXCEEDED, `Please wait ${ttl}s before requesting another verification email.`);
    return;
  }

  const result = await db.query(
    `SELECT id, email_verified, key_hash
     FROM api_keys
     WHERE email = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [normalizedEmail]
  );

  if (result.rows.length === 0) {
    sendError(res, ErrorCode.NOT_FOUND, 'No account found with this email address.');
    return;
  }

  const row = result.rows[0];

  if (row.email_verified) {
    sendError(res, ErrorCode.CONFLICT, 'Email is already verified.');
    return;
  }

  const newToken = generateVerificationToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await db.query(
    `UPDATE api_keys
       SET email_verification_token = $1,
           email_verification_expires_at = $2,
           email_verification_sent_at = NOW()
     WHERE id = $3`,
    [newToken, expiresAt, row.id]
  );

  // Set rate limit: 60s
  await redis.set(rateLimitKey, '1', 'EX', 60);

  const backfill = req.body && req.body.backfill === true;
  await sendVerificationEmail(normalizedEmail, newToken, { backfill });

  res.json({ message: 'Verification email resent.' });
});

// GET /v1/auth/me — inspect metadata for the authenticated key
router.get('/me', requireApiKey, async (req: Request, res: Response) => {
  const keyRecord = req.apiKeyRecord;
  if (!keyRecord) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const result = await db.query(
    `SELECT id, email, tier, daily_limit, rpm_limit, created_at, last_used_at, total_queries
     FROM api_keys
     WHERE id = $1`,
    [keyRecord.id]
  );

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'key not found' });
    return;
  }

  const row = result.rows[0];
  const tierLimits = TIER_LIMITS[row.tier] ?? FREE_TIER;
  const dailyLimit = (row.daily_limit && row.daily_limit > 0) ? row.daily_limit : tierLimits.daily;
  const rpmLimit = (row.rpm_limit && row.rpm_limit > 0) ? row.rpm_limit : tierLimits.rpm;

  res.json({
    key_id: row.id,
    email: row.email || null,
    tier: row.tier,
    limits: {
      queries_per_day: dailyLimit,
      requests_per_second: rpmLimit,
    },
    created_at: row.created_at ? row.created_at.toISOString() : null,
    last_used_at: row.last_used_at ? row.last_used_at.toISOString() : null,
    total_queries: row.total_queries || 0,
  });
});

// Infer signup channel from referer + UTM
function resolveSignupChannel(referer: string | undefined, utmSource?: string, utmMedium?: string): string {
  if (utmSource) {
    const src = utmSource.toLowerCase();
    if (src.includes('github')) return 'github';
    if (src.includes('producthunt') || src.includes('product_hunt')) return 'product_hunt';
    if (src.includes('google')) return 'google_search';
    if (src.includes('blog')) return 'blog_post';
    if (src.includes('social') || src.includes('twitter') || src.includes('linkedin')) return 'social';
    if (utmMedium?.includes('referral')) return 'referral';
    return utmSource;
  }
  if (referer) {
    if (/github\.com/i.test(referer)) return 'github';
    if (/google\.com/i.test(referer)) return 'google_search';
    if (/producthunt\.com/i.test(referer)) return 'product_hunt';
  }
  return 'direct';
}

export default router;
