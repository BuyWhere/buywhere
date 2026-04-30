import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { db, FREE_TIER } from '../config';
import { trackRegistration } from '../analytics/posthog';

const router = Router();

function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

// POST /v1/auth/register
// Headless agent self-registration — no human approval required
router.post('/register', async (req: Request, res: Response) => {
  const { agent_name, contact, use_case } = req.body;

  if (!agent_name || typeof agent_name !== 'string') {
    res.status(400).json({ error: 'agent_name is required' });
    return;
  }

  // Generate API key (raw key returned once, only hash stored)
  const rawKey = `bw_${uuidv4().replace(/-/g, '')}`;
  const keyHash = hashKey(rawKey);

  // UTM / attribution from query params or body
  const utmSource = (req.query.utm_source || req.body.utm_source) as string | undefined;
  const utmMedium = (req.query.utm_medium || req.body.utm_medium) as string | undefined;
  const signupChannel = resolveSignupChannel(req.headers['referer'], utmSource, utmMedium);

  await db.query(
    `INSERT INTO api_keys
       (id, key_hash, name, contact, use_case, tier, is_active,
        signup_channel, attribution_source, developer_id)
     VALUES (gen_random_uuid(),$1,$2,$3,$4,'free',true,$5,$6,'self-registered')`,
    [
      keyHash,
      agent_name.trim().slice(0, 200),
      contact ? String(contact).slice(0, 500) : null,
      use_case ? String(use_case).slice(0, 1000) : null,
      signupChannel,
      utmSource || null,
    ]
  );

  // Fire PostHog registration event (async, non-blocking)
  // Use hashed key to avoid sending raw API key to third-party analytics
  trackRegistration(hashKey(rawKey), agent_name, signupChannel, utmSource || null);

  res.status(201).json({
    api_key: rawKey,
    tier: 'free',
    rate_limit: {
      rpm: FREE_TIER.rpm,
      daily: FREE_TIER.daily,
    },
    docs: 'https://api.buywhere.ai/docs',
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
