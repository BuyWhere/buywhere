"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const errors_1 = require("../middleware/errors");
const router = (0, express_1.Router)();
const PAPERCLIP_API_URL = process.env.PAPERCLIP_API_URL || 'https://api.paperclip.ai';
const PAPERCLIP_API_KEY = process.env.PAPERCLIP_API_KEY;
const UPTIMEROBOT_WEBHOOK_SECRET = process.env.UPTIMEROBOT_WEBHOOK_SECRET;
const UPTIMEROBOT_ISSUE_ID = process.env.UPTIMEROBOT_ISSUE_ID || '0d3648af-2d05-4494-9ffe-0199de71cd57';
function formatAlertComment(payload) {
    const { monitorFriendlyName, alertTypeFriendlyName, alertDetails, alertDuration, monitorURL } = payload;
    const icon = alertTypeFriendlyName === 'Up' ? '\u2705' : '\u{1F534}';
    const durationText = alertDuration && alertDuration !== '0'
        ? ` (duration: ${alertDuration}s)`
        : '';
    return [
        `${icon} **UptimeRobot: ${alertTypeFriendlyName}**`,
        '',
        `- Monitor: \`${monitorFriendlyName}\``,
        `- URL: ${monitorURL}`,
        `- Status: ${alertTypeFriendlyName}${durationText}`,
        `- Details: ${alertDetails}`,
        '',
        '@Atlas',
    ].join('\n');
}
async function postPaperclipComment(issueId, commentBody) {
    if (!PAPERCLIP_API_KEY) {
        console.warn('[webhooks] PAPERCLIP_API_KEY not set — skipping Paperclip comment');
        return;
    }
    const url = `${PAPERCLIP_API_URL}/api/issues/${issueId}/comments`;
    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${PAPERCLIP_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body: commentBody }),
    });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Paperclip API returned ${resp.status} ${resp.statusText}: ${text}`);
    }
    console.log('[webhooks] Paperclip comment posted successfully');
}
// POST /webhooks/uptime-robot
router.post('/uptime-robot', async (req, res) => {
    // Validate shared secret if configured
    if (UPTIMEROBOT_WEBHOOK_SECRET) {
        const providedSecret = req.headers['x-uptimerobot-secret'];
        if (!providedSecret || providedSecret !== UPTIMEROBOT_WEBHOOK_SECRET) {
            (0, errors_1.sendError)(res, errors_1.ErrorCode.FORBIDDEN, 'Invalid webhook secret');
            return;
        }
    }
    const body = req.body;
    // Validate required UptimeRobot fields
    if (!body || typeof body !== 'object') {
        (0, errors_1.sendError)(res, errors_1.ErrorCode.INVALID_PARAMETER, 'Request body must be a JSON object');
        return;
    }
    if (!body.monitorID) {
        (0, errors_1.sendError)(res, errors_1.ErrorCode.MISSING_REQUIRED_FIELD, 'monitorID is required');
        return;
    }
    if (!body.alertTypeFriendlyName) {
        (0, errors_1.sendError)(res, errors_1.ErrorCode.MISSING_REQUIRED_FIELD, 'alertTypeFriendlyName is required');
        return;
    }
    const payload = {
        monitorID: String(body.monitorID),
        monitorURL: String(body.monitorURL || ''),
        monitorFriendlyName: String(body.monitorFriendlyName || body.monitorID),
        alertType: String(body.alertType || ''),
        alertTypeFriendlyName: String(body.alertTypeFriendlyName),
        alertDetails: String(body.alertDetails || ''),
        alertDuration: String(body.alertDuration || '0'),
        monitorAlertContacts: String(body.monitorAlertContacts || ''),
    };
    // Acknowledge immediately — UptimeRobot expects fast response
    res.status(200).json({ status: 'ok' });
    // Post Paperclip comment asynchronously (fire-and-forget)
    const commentBody = formatAlertComment(payload);
    try {
        await postPaperclipComment(UPTIMEROBOT_ISSUE_ID, commentBody);
    }
    catch (err) {
        console.error('[webhooks] Failed to post Paperclip comment:', err.message);
    }
});
exports.default = router;
