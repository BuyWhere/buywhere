import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { createHash, randomBytes } from 'crypto';
import { db, FREE_TIER, DEVELOPER_TIER, redis } from '../config';
import { trackRegistration, trackEmailVerified } from '../analytics/posthog';
import { sendVerificationEmail } from '../email';
import { sendError } from '../middleware/errors';
import { ErrorCode } from '../middleware/errors';

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const UNVERIFIED_TIER = { rpm: 5, daily: 50 };

function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

function generateVerificationToken(): string {
  return randomBytes(32).toString('hex');
}

// POST /v1/auth/register
// Self-registration — email optional. With email: unverified tier + verification flow.
// Without email: free tier, instant activation.
router.post('/register', async (req: Request, res: Response) => {
  const { agent_name, email, contact, use_case } = req.body;

  if (!agent_name || typeof agent_name !== 'string') {
    res.status(400).json({ error: 'agent_name is required' });
    return;
  }

  const emailAddr = (email || contact || '') as string;
  const hasEmail = emailAddr && EMAIL_RE.test(emailAddr);

  // If email was provided but invalid, reject
  if (emailAddr && !hasEmail) {
    sendError(res, ErrorCode.INVALID_PARAMETER, 'Email address is invalid. Omit it entirely for instant key, or provide a valid one.');
    return;
  }

  // Generate API key (raw key returned once, only hash stored)
  const rawKey = `bw_${uuidv4().replace(/-/g, '')}`;
  const keyHash = hashKey(rawKey);

  // UTM / attribution from query params or body
  const utmSource = (req.query.utm_source || req.body.utm_source) as string | undefined;
  const utmMedium = (req.query.utm_medium || req.body.utm_medium) as string | undefined;
  const signupChannel = resolveSignupChannel(req.headers['referer'], utmSource, utmMedium);

  if (hasEmail) {
    // Email flow: unverified tier, pending email verification
    const verificationToken = generateVerificationToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await db.query(
      `INSERT INTO api_keys
         (id, key_hash, name, email, contact, use_case, tier, is_active,
          signup_channel, attribution_source, developer_id,
          email_verification_token, email_verification_expires_at)
        VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,'unverified',true,$6,$7,'self-registered',$8,$9)`,
      [
        keyHash,
        agent_name.trim().slice(0, 200),
        emailAddr.slice(0, 500),
        emailAddr.slice(0, 500),
        use_case ? String(use_case).slice(0, 1000) : null,
        signupChannel,
        utmSource || null,
        verificationToken,
        expiresAt,
      ]
    );

    trackRegistration(hashKey(rawKey), agent_name, signupChannel, utmSource || null);

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

    res.status(201).json({
      api_key: rawKey,
      tier: 'unverified',
      email_verified: false,
      rate_limit: {
        rpm: UNVERIFIED_TIER.rpm,
        daily: UNVERIFIED_TIER.daily,
      },
      message: 'Verify your email to unlock higher rate limits.',
      docs: 'https://api.buywhere.ai/docs',
    });
  } else {
    // No email: instant free-tier activation
    await db.query(
      `INSERT INTO api_keys
         (id, key_hash, name, use_case, tier, is_active,
          signup_channel, attribution_source, developer_id)
        VALUES (gen_random_uuid(),$1,$2,$3,'free',true,$4,$5,'self-registered')`,
      [
        keyHash,
        agent_name.trim().slice(0, 200),
        use_case ? String(use_case).slice(0, 1000) : null,
        signupChannel,
        utmSource || null,
      ]
    );

    trackRegistration(hashKey(rawKey), agent_name, signupChannel, utmSource || null);

    res.status(201).json({
      api_key: rawKey,
      tier: 'free',
      email_verified: false,
      rate_limit: {
        rpm: FREE_TIER.rpm,
        daily: FREE_TIER.daily,
      },
      docs: 'https://api.buywhere.ai/docs',
    });
  }
});

// POST /v1/auth/register/agent
// Agent self-registration — returns key instantly without email verification
router.post('/register/agent', async (req: Request, res: Response) => {
  const { agent_name, use_case } = req.body;

  const rawKey = `bw_${uuidv4().replace(/-/g, '')}`;
  const keyHash = hashKey(rawKey);

  await db.query(
    `INSERT INTO api_keys
       (id, key_hash, name, use_case, tier, is_active,
        developer_id, email_verified, rpm_limit, daily_limit)
      VALUES (gen_random_uuid(),$1,$2,$3,'developer',true,'agent-registered',true,$4,$5)`,
    [
      keyHash,
      agent_name ? String(agent_name).trim().slice(0, 200) : 'Agent',
      use_case ? String(use_case).slice(0, 1000) : null,
      DEVELOPER_TIER.rpm,
      DEVELOPER_TIER.daily,
    ]
  );

  res.status(201).json({
    api_key: rawKey,
    tier: 'developer',
    email_verified: true,
    rate_limit: {
      rpm: DEVELOPER_TIER.rpm,
      daily: DEVELOPER_TIER.daily,
    },
    docs: 'https://api.buywhere.ai/docs',
  });
});

// GET /v1/auth/verify?token=xxx
router.get('/verify', async (req: Request, res: Response) => {
  const { token } = req.query;

  if (!token || typeof token !== 'string') {
    sendError(res, ErrorCode.INVALID_PARAMETER, 'Verification token is required.');
    return;
  }

  const result = await db.query(
    `UPDATE api_keys
       SET email_verified = true,
           email_verification_token = NULL,
           email_verification_expires_at = NULL,
           tier = 'free'
     WHERE email_verification_token = $1
       AND email_verified = false
       AND (email_verification_expires_at IS NULL OR email_verification_expires_at > NOW())
     RETURNING id, email, tier, rpm_limit, daily_limit`,
    [token]
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

  trackEmailVerified(id, verifiedEmail);

  res.json({
    message: 'Email verified successfully.',
    tier,
    rate_limit: {
      rpm: rpm_limit,
      daily: daily_limit,
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

  await sendVerificationEmail(normalizedEmail, newToken);

  res.json({ message: 'Verification email resent.' });
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
