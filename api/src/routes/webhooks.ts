import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { db, redis } from '../config';

const router = Router();

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const PAPERCLIP_BASE_URL = process.env.UPTIMEROBOT_WEBHOOK_RELAY_URL?.trim() || '';
const PAPERCLIP_API_KEY = process.env.UPTIMEROBOT_WEBHOOK_RELAY_API_KEY?.trim() || '';
const UPTIMEROBOT_API_KEY = process.env.UPTIMEROBOT_API_KEY?.trim() || process.env.UPTIMEROBOT_KEY?.trim() || '';
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

/** Known BuyWhere production host suffixes that should create incidents. */
const SUPPORTED_MONITOR_HOSTS = [
  'buywhere.ai',
  'api.buywhere.ai',
  'mcp.buywhere.ai',
  'www.buywhere.ai',
  'buywhere-monitoring-api.up.railway.app',
];

/**
 * BUY-57443: Allowlist of canonical production UptimeRobot monitor IDs.
 * Any incoming alert with a monitorID not in this set is silently dropped.
 * This is the primary defense against phantom monitor IDs (e.g. 999999 from
 * external accounts) creating bogus incidents — the URL host check is the
 * second line of defense.
 */
const SUPPORTED_MONITOR_IDS = new Set<string>([
  '802985723',
  '802985724',
  '802964898',
  '803121776',
  '802964899',
  '802964896',
  '803121777',
  '803121778',
  '803294913',
  '802985725',
]);

/**
 * Returns true if the monitor URL points to a supported BuyWhere production host.
 * Unsupported hosts (e.g. dedup.ai) are silently ignored.
 */
const isSupportedMonitorHost = (monitorURL: string): boolean => {
  try {
    const hostname = new URL(monitorURL).hostname.toLowerCase();
    return SUPPORTED_MONITOR_HOSTS.some((host) => hostname === host || hostname.endsWith('.' + host));
  } catch {
    return true;
  }
};

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

// BUY-57479/BUY-57480: Dedup key must be strictly the monitorID. Falling back
// to friendly_name caused dedup misses when two UptimeRobot accounts share a
// numeric monitor ID with different friendly names (root cause of BUY-57476).
const dedupKey = (alert: UptimeRobotAlert, status: 'down' | 'up'): string | null => {
  if (alert.monitorID == null) return null;
  const monitorID = String(alert.monitorID);
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

// BUY-57479/BUY-57480: Fetch authoritative monitor.url + friendly_name from
// UptimeRobot v2 API using the configured API key. Used to (a) overwrite the
// alert payload URL when the alert URL disagrees with monitor.url by hostname,
// and (b) prepend [possibly-mislabeled] to the incident title so on-call sees
// the disagreement. Cached 5 minutes to avoid hitting UptimeRobot API per-alert.
interface UptimeRobotMonitor {
  id: number | string;
  friendly_name: string;
  url: string;
}

const monitorCache = new Map<string, { value: UptimeRobotMonitor | null; expiresAt: number }>();
const MONITOR_CACHE_TTL_MS = 5 * 60 * 1000;

const fetchMonitorFromUptimeRobot = async (monitorID: string): Promise<UptimeRobotMonitor | null> => {
  if (!UPTIMEROBOT_API_KEY) return null;
  const cached = monitorCache.get(monitorID);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    const body = new URLSearchParams({
      api_key: UPTIMEROBOT_API_KEY,
      format: 'json',
      monitors: monitorID,
    });
    const res = await fetch('https://api.uptimerobot.com/v2/getMonitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      console.warn(`[webhooks/uptime-robot] getMonitors ${monitorID} -> ${res.status}`);
      monitorCache.set(monitorID, { value: null, expiresAt: Date.now() + 60_000 });
      return null;
    }
    const data = await res.json() as { stat?: string; monitors?: UptimeRobotMonitor[] };
    const mon = data.monitors?.[0] ?? null;
    monitorCache.set(monitorID, { value: mon, expiresAt: Date.now() + MONITOR_CACHE_TTL_MS });
    return mon;
  } catch (err) {
    console.warn(`[webhooks/uptime-robot] getMonitors ${monitorID} failed:`, (err as Error).message);
    return null;
  }
};

const hostnameOf = (url: string): string | null => {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
};

const createPaperclipIssue = async (alert: UptimeRobotAlert, isDown: boolean): Promise<void> => {
  if (!PAPERCLIP_BASE_URL || !PAPERCLIP_API_KEY) {
    console.warn('[webhooks/uptime-robot] Relay not configured (missing URL or API key)');
    return;
  }

  // BUY-57479/BUY-57480: prefer authoritative monitor data from UptimeRobot v2.
  const monitorIDStr = alert.monitorID != null ? String(alert.monitorID) : '';
  const authoritativeMonitor = monitorIDStr ? await fetchMonitorFromUptimeRobot(monitorIDStr) : null;

  const alertFriendlyName = alert.monitorFriendlyName || alert.monitorName || alert.monitor_name || 'unknown';
  const alertMonitorURL = alert.monitorURL || 'unknown';

  const friendlyName = authoritativeMonitor?.friendly_name || alertFriendlyName;
  const monitorURL = authoritativeMonitor?.url || alertMonitorURL;

  // BUY-57480: if the alert URL hostname disagrees with the authoritative
  // monitor URL hostname, mark the incident as possibly-mislabeled and include
  // both URLs so on-call sees the disagreement.
  const alertHost = hostnameOf(alertMonitorURL);
  const authHost = hostnameOf(monitorURL);
  const hostMismatch = !!(alertHost && authHost && alertHost !== authHost);

  const alertDetails = alert.alertDetails || alert.alert_details || '';
  const status = isDown ? 'DOWN' : 'UP';
  const timestamp = new Date().toISOString();

  const titlePrefix = hostMismatch ? '[possibly-mislabeled] ' : '';
  const title = `${titlePrefix}[INCIDENT] ${status} — ${friendlyName}`;
  const description = [
    `**Service:** ${friendlyName}`,
    `**Status:** ${status}`,
    `**Time:** ${timestamp}`,
    `**Check URL:** ${monitorURL}`,
  ];
  if (hostMismatch) {
    description.push(
      '',
      '**⚠️ URL MISMATCH:**',
      '| Source | URL | Host |',
      '| --- | --- | --- |',
      `| UptimeRobot monitor.url (authoritative) | ${monitorURL} | ${authHost} |`,
      `| Alert payload monitorURL | ${alertMonitorURL} | ${alertHost} |`,
    );
  }
  if (alertDetails) {
    description.push(`**Details:** ${alertDetails}`);
  }
  if (monitorIDStr) {
    description.push(`**Monitor ID:** ${monitorIDStr}`);
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

// BUY-47930: UP-recovery. When a monitor transitions DOWN -> UP, resolve the
// matching open DOWN incident instead of creating a standalone UP issue. We
// look for an open incident whose description references the same monitor ID,
// falling back to a title match on friendlyName / monitor URL host.
interface PaperclipIssue {
  id: string;
  identifier?: string;
  title?: string;
  description?: string;
  status: string;
}

const OPEN_INCIDENT_STATUSES = ['todo', 'in_progress', 'in_review', 'backlog'];

const findOpenIncidentByMonitor = async (
  monitorID: string,
  friendlyName: string,
  monitorURL: string,
): Promise<PaperclipIssue | null> => {
  if (!PAPERCLIP_BASE_URL || !PAPERCLIP_API_KEY) return null;
  const host = hostnameOf(monitorURL);
  const needles: string[] = [];
  if (monitorID) needles.push(`**Monitor ID:** ${monitorID}`);
  if (friendlyName && friendlyName !== 'unknown') needles.push(friendlyName);
  if (host) needles.push(host);

  for (const status of OPEN_INCIDENT_STATUSES) {
    const url = `${ISSUES_ENDPOINT}?status=${encodeURIComponent(status)}&limit=50`;
    try {
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${PAPERCLIP_API_KEY}` },
      });
      if (!res.ok) {
        console.warn(`[webhooks/uptime-robot] findOpenIncident list status=${status} -> ${res.status}`);
        continue;
      }
      const data = (await res.json()) as PaperclipIssue[] | { issues?: PaperclipIssue[] };
      const issues: PaperclipIssue[] = Array.isArray(data) ? data : (data?.issues ?? []);
      for (const issue of issues) {
        const haystack = `${issue.title || ''}\n${issue.description || ''}`;
        const isDownIncident = /\[INCIDENT\]\s*DOWN/i.test(issue.title || '');
        if (!isDownIncident) continue;
        if (needles.some((n) => haystack.includes(n))) {
          return issue;
        }
      }
    } catch (err) {
      console.warn('[webhooks/uptime-robot] findOpenIncident request failed:', (err as Error).message);
    }
  }
  return null;
};

const closePaperclipIncident = async (
  issueId: string,
  recoverySummary: string,
): Promise<boolean> => {
  if (!PAPERCLIP_BASE_URL || !PAPERCLIP_API_KEY) return false;
  const patchUrl = `${PAPERCLIP_BASE_URL}/api/issues/${issueId}`;
  try {
    const res = await fetch(patchUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PAPERCLIP_API_KEY}`,
      },
      body: JSON.stringify({
        status: 'done',
        comment: `\u{1F7E2} **Auto-resolved by UP-recovery (BUY-47930).** ${recoverySummary}`,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[webhooks/uptime-robot] closePaperclipIncident ${issueId} -> ${res.status}: ${body}`);
      return false;
    }
    console.log(`[webhooks/uptime-robot] Resolved open DOWN incident ${issueId} via UP-recovery.`);
    return true;
  } catch (err) {
    console.warn('[webhooks/uptime-robot] closePaperclipIncident request failed:', (err as Error).message);
    return false;
  }
};

// Resolves the matching open DOWN incident for an UP event; returns true if an
// incident was found and closed so the caller can skip a redundant UP issue.
const resolveDownIncidentOnUp = async (alert: UptimeRobotAlert): Promise<boolean> => {
  const monitorIDStr = alert.monitorID != null ? String(alert.monitorID) : '';
  const authoritativeMonitor = monitorIDStr ? await fetchMonitorFromUptimeRobot(monitorIDStr) : null;
  const friendlyName = authoritativeMonitor?.friendly_name
    || alert.monitorFriendlyName
    || alert.monitorName
    || alert.monitor_name
    || 'unknown';
  const monitorURL = authoritativeMonitor?.url || alert.monitorURL || 'unknown';

  const open = await findOpenIncidentByMonitor(monitorIDStr, friendlyName, monitorURL);
  if (!open) {
    console.log(`[webhooks/uptime-robot] UP-recovery: no open DOWN incident matched monitor=${monitorIDStr} (${friendlyName}).`);
    return false;
  }
  const summary = `Monitor ${friendlyName} (${monitorURL}) reported UP at ${new Date().toISOString()}. Matching DOWN incident ${open.identifier || open.id} auto-closed.`;
  return closePaperclipIncident(open.id, summary);
};

router.post('/uptime-robot', async (req: Request, res: Response) => {
  const payload = req.body as UptimeRobotAlert;
  console.log('[webhooks/uptime-robot] Received alert:', JSON.stringify(payload));

  const status = alertStatus(payload);
  const friendlyName = payload?.monitorFriendlyName || payload?.monitorName || payload?.monitor_name || 'unknown';
  const monitorURL = payload?.monitorURL || 'unknown';
  const alertDetails = payload?.alertDetails ?? payload?.alert_details ?? '';
  const monitorID = payload?.monitorID != null ? String(payload.monitorID) : '';

  // BUY-57443: First line of defense — reject phantom monitor IDs not in the
  // production allowlist. Phantom IDs (e.g. 999999 from an external UptimeRobot
  // account) were creating real Paperclip incidents routed to Rex.
  if (monitorID && !SUPPORTED_MONITOR_IDS.has(monitorID)) {
    console.warn(`[webhooks/uptime-robot] Ignoring alert for unknown monitorID: ${monitorID} (friendlyName=${friendlyName}, monitorURL=${monitorURL})`);
    res.status(202).json({ received: true, ignored: true, reason: 'unknown_monitor_id' });
    return;
  }

  // BUY-57443: Second line of defense — URL host check catches spoofed hosts
  // for legitimate monitor IDs.
  if (!isSupportedMonitorHost(monitorURL)) {
    console.warn(`[webhooks/uptime-robot] Ignoring alert for unsupported host: ${monitorURL} (friendlyName=${friendlyName})`);
    res.status(202).json({ ignored: true, reason: 'unsupported_monitor_host' });
    return;
  }

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
      // BUY-47930: resolve the matching open DOWN incident; only create a
      // standalone UP issue if no open DOWN incident matched, to avoid
      // leaving stale in_progress incidents and spurious UP tickets.
      void (async () => {
        try {
          const resolved = await resolveDownIncidentOnUp(payload);
          if (!resolved) {
            await createPaperclipIssue(payload, false);
          }
        } catch (err) {
          console.error('[webhooks/uptime-robot] UP-recovery error:', err);
        }
      })();
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
