"use strict";
// Verification email sender — AgentMail-backed (restored 2026-08-08).
//
// This was a stub ("email delivery disabled") from d75e8d3 onward: 212 verification
// emails "sent" in 30 days, ZERO delivered, 1,014 keys stuck in unverified tier
// (20 rpm) that could be verified_agent (200 rpm). Never stub this again — if
// delivery must be disabled, return false so email_verification_sent_at stays
// NULL and /v1/auth/resend-verification remains meaningful.
//
// Env: AGENTMAIL_API_KEY + AGENTMAIL_INBOX_ID (sender, e.g. signups@buywhere.ai),
// optional VERIFY_BASE_URL (default https://api.buywhere.ai).
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendVerificationEmail = sendVerificationEmail;
async function sendVerificationEmail(email, token) {
    const apiKey = process.env.AGENTMAIL_API_KEY ?? '';
    const inbox = process.env.AGENTMAIL_INBOX_ID ?? '';
    if (!apiKey || !inbox) {
        console.warn('[email] AGENTMAIL_API_KEY / AGENTMAIL_INBOX_ID not set — verification email NOT sent');
        return false;
    }
    const base = process.env.VERIFY_BASE_URL || 'https://api.buywhere.ai';
    const link = `${base}/v1/auth/verify?token=${encodeURIComponent(token)}`;
    const text = [
        'Welcome to BuyWhere — the product catalog built for AI agents.',
        '',
        'Verify your email to upgrade your API key from the unverified tier',
        '(20 requests/min) to verified_agent (200 requests/min, 10,000/day):',
        '',
        link,
        '',
        'Agent operators: this link is a plain GET — your agent can follow it',
        'programmatically. The link expires in 48 hours; request a fresh one at',
        'POST https://api.buywhere.ai/v1/auth/resend-verification { "email": "..." }.',
        '',
        'Docs: https://buywhere.ai/docs  ·  MCP: https://mcp.buywhere.ai',
    ].join('\n');
    const html = `<p>Welcome to <strong>BuyWhere</strong> — the product catalog built for AI agents.</p>
<p>Verify your email to upgrade your API key from the unverified tier (20 req/min)
to <strong>verified_agent</strong> (200 req/min, 10,000/day):</p>
<p><a href="${link}">Verify my API key</a></p>
<p style="color:#666;font-size:13px">Agent operators: the link is a plain GET — your agent can follow it
programmatically. Expires in 48 h; request a fresh one via
<code>POST /v1/auth/resend-verification</code>.</p>
<p style="color:#666;font-size:13px"><a href="https://buywhere.ai/docs">Docs</a> · <a href="https://mcp.buywhere.ai">MCP server</a></p>`;
    try {
        const resp = await fetch(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inbox)}/messages/send`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: [email], subject: 'Verify your BuyWhere API key — unlocks 10x rate limits', text, html }),
        });
        if (!resp.ok) {
            console.warn('[email] agentmail send failed:', resp.status, await resp.text().catch(() => ''));
            return false;
        }
        return true;
    }
    catch (err) {
        console.warn('[email] send error:', err?.message);
        return false;
    }
}
