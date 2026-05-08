import { Router, Request, Response } from 'express';

const router = Router();
const PAPERCLIP_BASE_URL = process.env.UPTIMEROBOT_WEBHOOK_RELAY_URL?.trim() || '';
const PAPERCLIP_API_KEY = process.env.UPTIMEROBOT_WEBHOOK_RELAY_API_KEY?.trim() || '';
const COMPANY_ID = '177bc805-e3c8-4336-84cb-8e1e482d5a17';
const ISSUES_ENDPOINT = `${PAPERCLIP_BASE_URL}/api/companies/${COMPANY_ID}/issues`;
const REX_AGENT_ID = '8ca957f8-0911-4e81-a963-e2cf54c97d44';
const PARENT_ISSUE_ID = '79d50257-93fa-43d2-9042-bc14bcafd4b4'; // BUY-13701
const GOAL_ID = '2c19e8cc-3e32-4144-8fcb-c4f206cb9fa4';

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

router.post('/uptime-robot', (req: Request, res: Response) => {
  const payload = req.body as UptimeRobotAlert;
  console.log('[webhooks/uptime-robot] Received alert:', JSON.stringify(payload));

  const alertType = payload?.alertType ?? payload?.alert_type;
  const friendlyName = payload?.monitorFriendlyName || payload?.monitorName || payload?.monitor_name || 'unknown';
  const monitorURL = payload?.monitorURL || 'unknown';
  const alertDetails = payload?.alertDetails ?? payload?.alert_details ?? '';

  const isDown = alertType === 1 || alertType === '1' || alertType === 'down' || alertType === 'DOWN' || alertType === 'Down';
  const isUp = alertType === 2 || alertType === '2' || alertType === 'up' || alertType === 'UP' || alertType === 'Up';

  if (isDown) {
    console.warn(`[webhooks/uptime-robot] Monitor DOWN: ${friendlyName} (${monitorURL}) — ${alertDetails}`);
    void createPaperclipIssue(payload, true);
  } else if (isUp) {
    console.log(`[webhooks/uptime-robot] Monitor UP: ${friendlyName} (${monitorURL})`);
    void createPaperclipIssue(payload, false);
  } else {
    console.log(`[webhooks/uptime-robot] Alert type ${alertType}: ${friendlyName} (${monitorURL}) — ${alertDetails}`);
  }

  res.status(200).json({ received: true });
});

export default router;
