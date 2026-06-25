import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { db, redis } from '../config';

const router = Router();

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-04-22.dahlia' })
  : null;

const PAPERCLIP_BASE_URL = process.env.UPTIMEROBOT_WEBHOOK_RELAY_URL?.trim() || '';
const PAPERCLIP_API_KEY = process.env.UPTIMEROBOT_WEBHOOK_RELAY_API_KEY?.trim() || '';
const COMPANY_ID = '177bc805-e3c8-4336-84cb-8e1e482d5a17';
const ISSUES_ENDPOINT = `${PAPERCLIP_BASE_URL}/api/companies/${COMPANY_ID}/issues`;
const REX_AGENT_ID = '8ca957f8-0911-4e81-a963-e2cf54c97d44';
const PARENT_ISSUE_ID = '79d50257-93fa-43d2-9042-bc14bcafd4b4'; // BUY-13701
const GOAL_ID = '2c19e8cc-3e32-4144-8fcb-c4f206cb9fa4';

// Redis-backed dedup for UptimeRobot webhook alerts (BUY-57442).
// UptimeRobot can fire duplicate alerts while a monitor is still DOWN, and the
// relay used to forward every duplicate into a new Paperclip issue. We dedup
// per (monitorID, alertType, status-bucket) for 5 minutes; a state transition
// (DOWN -> UP) starts a fresh window because the alertType changes.
const DEDUP_PREFIX = 'uptime:dedup:';
const DEDUP_TTL_SECONDS = 300;
const DEDUP_ENABLED = !!redis;

interface UptimeRobotAlert {
  monitorID?: string;
  monitorURL?: string;
  monitorFriendlyName?: string;
  monitorName?: string;
  monitor_name?: string;
  alertType?: number | string;
  alert_type?: number | string;
  alertTypeFriendlyName?: string;
  alertDetails?: string;
  alert_details?: string;
  alertDuration?: string;
  monitorStatusCode?: string;
}

const alertStatus = (alert: UptimeRobotAlert): 'down' | 'up' | 'other' => {
  const alertType = alert.alertType ?? alert.alert_type;
  if (alertType === 1 || alertType === '1' || alertType === 'down' || alertType === 'DOWN' || alertType === 'Down') {
    return 'down';
  }
  if (alertType === 2 || alertType === '2' || alertType === 'up' || alertType === 'UP' || alertType === 'Up') {
    return 'up';
  }
  return 'other';
};

const dedupKey = (alert: UptimeRobotAlert, status: 'down' | 'up'): string | null => {
  const monitorID = alert.monitorID || alert.monitorFriendlyName || alert.monitorName || alert.monitor_name;
  if (!monitorID) return null;
  return `${DEDUP_PREFIX}${monitorID}:${status}`;
};

const claimDedupSlot = async (key: string): Promise<boolean> => {
  if (!DEDUP_ENABLED) return true;
  try {
    const result = await (redis as any).set(key, '1', 'EX', DEDUP_TTL_SECONDS, 'NX');
    return result === 'OK' || result === true || result === 1;
  } catch (err) {
    console.warn('[webhooks/uptime-robot] Redis dedup SET failed (allowing create):', (err as Error).message);
    return true;
  }
};

const createPaperclipIssue = async (alert: UptimeRobotAlert, isDown: boolean): Promise<void> => {
  if (!PAPERCLIP_BASE_URL || !PAPERCLIP_API_KEY) {
    console.warn('[webhooks/uptime-robot] Relay not configured (missing URL or API key)');
    return;
  }

  const friendlyName = alert.monitorFriendlyName || alert.monitorName || alert.monitor_name || 'unknown';
  const monitorURL = alert.monitorURL || 'unknown';
  const alertDetails = alert.alertDetails || alert.alert_details || '';
  const status = isDown ? 'DOWN' : 'UP';
  const timestamp = new Date().toISOString();

  const title = `[INCIDENT] ${status} — ${friendlyName}`;
  const description = [
    `**Service:** ${friendlyName}`,
    `**Status:** ${status}`,
    `**Time:** ${timestamp}`,
    `**Check URL:** ${monitorURL}`,
  ];
  if (alertDetails) {
    description.push(`**Details:** ${alertDetails}`);
  }
  if (alert.monitorID) {
    description.push(`**Monitor ID:** ${alert.monitorID}`);
  }

  const issuePayload = {
    title,
    description: description.join('\n'),
    status: 'todo',
    priority: isDown ? 'critical' : 'medium',
    assigneeAgentId: REX_AGENT_ID,
    parentId: PARENT_ISSUE_ID,
    goalId: GOAL_ID,
  };

  try {
    const response = await fetch(ISSUES_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PAPERCLIP_API_KEY}`,
      },
      body: JSON.stringify(issuePayload),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.warn(`[webhooks/uptime-robot] Paperclip issue creation failed: ${response.status} — ${body}`);
    } else {
      console.log(`[webhooks/uptime-robot] Created Paperclip issue: ${title}`);
    }
  } catch (error) {
    console.error('[webhooks/uptime-robot] Paperclip API request failed:', error);
  }
};

router.post('/uptime-robot', async (req: Request, res: Response) => {
  const payload = req.body as UptimeRobotAlert;
  console.log('[webhooks/uptime-robot] Received alert:', JSON.stringify(payload));

  const status = alertStatus(payload);
  const friendlyName = payload?.monitorFriendlyName || payload?.monitorName || payload?.monitor_name || 'unknown';
  const monitorURL = payload?.monitorURL || 'unknown';
  const alertDetails = payload?.alertDetails ?? payload?.alert_details ?? '';

  try {
    if (status === 'down') {
      console.warn(`[webhooks/uptime-robot] Monitor DOWN: ${friendlyName} (${monitorURL}) — ${alertDetails}`);
      const key = dedupKey(payload, 'down');
      if (key) {
        const claimed = await claimDedupSlot(key);
        if (!claimed) {
          console.log(`[webhooks/uptime-robot] dedup-hit (down): ${key}`);
          res.status(200).json({ received: true, deduplicated: true });
          return;
        }
      }
      void createPaperclipIssue(payload, true);
    } else if (status === 'up') {
      console.log(`[webhooks/uptime-robot] Monitor UP: ${friendlyName} (${monitorURL})`);
      const key = dedupKey(payload, 'up');
      if (key) {
        const claimed = await claimDedupSlot(key);
        if (!claimed) {
          console.log(`[webhooks/uptime-robot] dedup-hit (up): ${key}`);
          res.status(200).json({ received: true, deduplicated: true });
          return;
        }
      }
      void createPaperclipIssue(payload, false);
    } else {
      console.log(`[webhooks/uptime-robot] Alert type ${payload?.alertType ?? payload?.alert_type}: ${friendlyName} (${monitorURL}) — ${alertDetails}`);
    }
  } catch (err) {
    console.error('[webhooks/uptime-robot] handler error:', err);
  }

  res.status(200).json({ received: true });
});

router.post('/stripe', async (req: Request, res: Response) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const stripeClient = stripe;

  const sig = req.headers['stripe-signature'] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('[webhooks/stripe] STRIPE_WEBHOOK_SECRET not configured');
    res.status(500).json({ error: 'Webhook secret not configured' });
    return;
  }

  let event: ReturnType<typeof stripeClient.webhooks.constructEvent>;

  try {
    const rawBody = JSON.stringify(req.body);
    event = stripeClient.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('[webhooks/stripe] Signature verification failed:', err);
    res.status(400).json({ error: 'Invalid signature' });
    return;
  }

  console.log(`[webhooks/stripe] Received event: ${event.type}`);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as { id: string; customer?: string | null };
        console.log(`[webhooks/stripe] Checkout completed: ${session.id}, customer: ${session.customer}`);
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as { id: string; status?: string | null };
        console.log(`[webhooks/stripe] Subscription ${event.type}: ${subscription.id}, status: ${subscription.status}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as { id: string };
        console.log(`[webhooks/stripe] Subscription deleted: ${subscription.id}`);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as { id: string; subscription?: string | null };
        console.log(`[webhooks/stripe] Invoice paid: ${invoice.id}, subscription: ${invoice.subscription}`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as { id: string };
        console.log(`[webhooks/stripe] Invoice payment failed: ${invoice.id}`);
        break;
      }

      default:
        console.log(`[webhooks/stripe] Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error(`[webhooks/stripe] Error handling event ${event.type}:`, err);
  }

  res.status(200).json({ received: true });
});

export default router;
