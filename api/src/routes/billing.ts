// BuyWhere subscription billing (built 2026-08-08, revenue loop).
//
// The pricing page has advertised $29 Starter / $99 Pro with checkout CTAs for
// weeks while POST /v1/billing/subscribe didn't exist — the paid funnel was a
// dead end. This route completes it via the Stripe REST API (no SDK dep).
//
// Env (on buywhere-api; ALL must be set or endpoints return 503 "billing not
// configured" — deploying without env is safe):
//   STRIPE_SECRET_KEY        sk_live_... — ⚠️ ACCOUNT CHOICE IS RICHMOND'S:
//                            droplet stripe-live.env belongs to the 8OS account.
//   STRIPE_PRICE_STARTER     price id for $29/mo (internal tier name: pro)
//   STRIPE_PRICE_PRO         price id for $99/mo (internal tier name: scale)
//   STRIPE_WEBHOOK_SECRET    whsec_... for /v1/billing/webhook
//
// Flow: subscribe → Checkout Session (client_reference_id = api key id) →
// webhook checkout.session.completed / customer.subscription.* → tier upgrade.
import { Router, Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { db } from '../config';
import { requireApiKey } from '../middleware/apiKey';

const router = Router();

const TIER_BY_PLAN: Record<string, { tier: string; priceEnv: string }> = {
  pro: { tier: 'pro', priceEnv: 'STRIPE_PRICE_STARTER' },     // $29 "Starter" on site
  scale: { tier: 'scale', priceEnv: 'STRIPE_PRICE_PRO' },     // $99 "Pro" on site
};

function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET
    && process.env.STRIPE_PRICE_STARTER && process.env.STRIPE_PRICE_PRO);
}

async function stripePost(path: string, form: Record<string, string>): Promise<any> {
  const resp = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(form).toString(),
  });
  const data: any = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(`stripe ${path}: ${resp.status} ${JSON.stringify(data?.error?.message ?? data).slice(0, 200)}`);
  return data;
}

// POST /v1/billing/subscribe { tier: "pro" | "scale" }
router.post('/subscribe', requireApiKey, async (req: Request, res: Response) => {
  if (!stripeConfigured()) {
    res.status(503).json({ error: 'billing_not_configured', message: 'Payments are not enabled yet. Contact partners@buywhere.ai.' });
    return;
  }
  const plan = TIER_BY_PLAN[String(req.body?.tier ?? '').toLowerCase()];
  if (!plan) {
    res.status(400).json({ error: 'invalid_tier', message: 'tier must be "pro" or "scale"' });
    return;
  }
  const keyRecord = req.apiKeyRecord!;
  try {
    const form: Record<string, string> = {
      mode: 'subscription',
      'line_items[0][price]': process.env[plan.priceEnv] as string,
      'line_items[0][quantity]': '1',
      client_reference_id: String(keyRecord.id),
      success_url: 'https://buywhere.ai/checkout/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://buywhere.ai/checkout/cancel',
      'subscription_data[metadata][api_key_id]': String(keyRecord.id),
      'subscription_data[metadata][target_tier]': plan.tier,
      'metadata[api_key_id]': String(keyRecord.id),
      'metadata[target_tier]': plan.tier,
      allow_promotion_codes: 'true',
    };
    const emailRow = await db.query('SELECT email FROM api_keys WHERE id = $1', [keyRecord.id]);
    const custEmail = emailRow.rows[0]?.email;
    if (custEmail) form.customer_email = String(custEmail);
    const session = await stripePost('checkout/sessions', form);
    res.json({ checkout_url: session.url, session_id: session.id });
  } catch (err) {
    console.error('[billing] subscribe failed:', (err as Error).message);
    res.status(502).json({ error: 'stripe_error', message: 'Could not create checkout session. Try again or contact partners@buywhere.ai.' });
  }
});

// GET /v1/billing/status
router.get('/status', requireApiKey, async (req: Request, res: Response) => {
  const k = req.apiKeyRecord!;
  const row = await db.query(
    `SELECT tier, subscription_status, current_period_end, daily_request_count, daily_limit
     FROM api_keys WHERE id = $1`, [k.id]);
  const r = row.rows[0] ?? {};
  res.json({
    tier: r.tier ?? k.tier,
    subscription_status: r.subscription_status ?? null,
    current_period_end: r.current_period_end ?? null,
    requests_today: r.daily_request_count ?? 0,
    requests_limit: r.daily_limit ?? null,
  });
});

// Stripe webhook signature check (v1 scheme) without the SDK.
function verifyStripeSignature(payload: string, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = parts['t']; const v1 = parts['v1'];
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false; // 5 min tolerance
  const expected = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  try {
    return timingSafeEqual(new Uint8Array(Buffer.from(expected, 'hex')), new Uint8Array(Buffer.from(v1, 'hex')));
  } catch { return false; }
}

const TIER_LIMITS_BY_TARGET: Record<string, { rpm: number; daily: number }> = {
  pro: { rpm: 100, daily: 10000 },
  scale: { rpm: 500, daily: 100000 },
};

// POST /v1/billing/webhook — mounted with express.raw() so req.body is a Buffer.
router.post('/webhook', async (req: Request, res: Response) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? '';
  if (!secret) { res.status(503).json({ error: 'billing_not_configured' }); return; }
  const payload = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);
  if (!verifyStripeSignature(payload, req.headers['stripe-signature'] as string | undefined, secret)) {
    res.status(400).json({ error: 'bad_signature' });
    return;
  }
  let event: any;
  try { event = JSON.parse(payload); } catch { res.status(400).json({ error: 'bad_payload' }); return; }

  try {
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      const apiKeyId = s.client_reference_id || s.metadata?.api_key_id;
      const targetTier = s.metadata?.target_tier;
      const limits = TIER_LIMITS_BY_TARGET[targetTier] ?? null;
      if (apiKeyId && limits) {
        await db.query(
          `UPDATE api_keys SET tier = $2, rpm_limit = $3, daily_limit = $4,
             stripe_customer_id = $5, stripe_subscription_id = $6,
             subscription_status = 'active', is_active = true
           WHERE id = $1`,
          [apiKeyId, targetTier, limits.rpm, limits.daily, s.customer ?? null, s.subscription ?? null]);
        console.log(`[billing] upgraded key ${apiKeyId} -> ${targetTier}`);
      }
    } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      const status = event.type.endsWith('deleted') ? 'canceled' : sub.status;
      const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
      await db.query(
        `UPDATE api_keys SET subscription_status = $2, current_period_end = $3
         WHERE stripe_subscription_id = $1`, [sub.id, status, periodEnd]);
      if (status === 'canceled' || status === 'unpaid') {
        // Downgrade to verified_agent limits at cancellation — never cut access abruptly mid-period.
        await db.query(
          `UPDATE api_keys SET tier = 'verified_agent', rpm_limit = 200, daily_limit = 10000
           WHERE stripe_subscription_id = $1 AND (current_period_end IS NULL OR current_period_end < NOW())`,
          [sub.id]);
      }
    }
    res.json({ received: true });
  } catch (err) {
    console.error('[billing] webhook handling failed:', (err as Error).message);
    res.status(500).json({ error: 'webhook_error' });
  }
});

export default router;
