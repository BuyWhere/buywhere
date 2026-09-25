"use strict";
// Verification email sender — ZHC agentic-inbox hub (inbox.vidmee.ai), 2026-08-25.
//
// History: stub (d75e8d3) → AgentMail (2026-08-08) which buywhere.ai's DMARC rejects → ZERO real
// customers ever received a verification email (266 signups since 2026-04-16). This sender posts
// through the self-hosted hub, from a real buywhere.ai mailbox, so DMARC/SPF align.
// Never stub this again — if delivery must be disabled, return false so email_verification_sent_at
// stays NULL and /v1/auth/resend-verification remains meaningful.
//
// Env: CF_ACCESS_CLIENT_ID + CF_ACCESS_CLIENT_SECRET (Cloudflare Access service token),
//      EMAIL_HUB_URL (default https://inbox.vidmee.ai/api/v1), EMAIL_HUB_MAILBOX (default signups@buywhere.ai),
//      optional VERIFY_BASE_URL (default https://api.buywhere.ai).
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendVerificationEmail = sendVerificationEmail;
async function sendVerificationEmail(email, token, opts = {}) {
    const clientId = process.env.CF_ACCESS_CLIENT_ID ?? '';
    const clientSecret = process.env.CF_ACCESS_CLIENT_SECRET ?? '';
    const hub = (process.env.EMAIL_HUB_URL || 'https://inbox.vidmee.ai/api/v1').replace(/\/+$/, '');
    const mailbox = process.env.EMAIL_HUB_MAILBOX || 'signups@buywhere.ai';
    if (!clientId || !clientSecret) {
        console.warn('[email] CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET not set — verification email NOT sent');
        return false;
    }
    const base = process.env.VERIFY_BASE_URL || 'https://api.buywhere.ai';
    const link = `${base}/v1/auth/verify?token=${encodeURIComponent(token)}`;
    const apology = opts.backfill
        ? 'Apologies — this confirmation should have reached you when you signed up. It did not, and that was our fault.'
        : '';
    const text = [
        'Welcome to BuyWhere — the product catalog built for AI agents.',
        '',
        ...(apology ? [apology, ''] : []),
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
        '',
        'Questions? Reply to this email or write to support@buywhere.ai.',
    ].join('\n');
    const html = `<p>Welcome to <strong>BuyWhere</strong> — the product catalog built for AI agents.</p>
${apology ? `<p>${apology}</p>` : ''}
<p>Verify your email to upgrade your API key from the unverified tier (20 req/min)
to <strong>verified_agent</strong> (200 req/min, 10,000/day):</p>
<p><a href="${link}">Verify my API key</a></p>
<p style="color:#666;font-size:13px">Agent operators: the link is a plain GET — your agent can follow it
programmatically. Expires in 48 h; request a fresh one via
<code>POST /v1/auth/resend-verification</code>.</p>
<p style="color:#666;font-size:13px"><a href="https://buywhere.ai/docs">Docs</a> · <a href="https://mcp.buywhere.ai">MCP server</a> · Questions? Reply to this email or write to support@buywhere.ai.</p>`;
    try {
        const resp = await fetch(`${hub}/mailboxes/${encodeURIComponent(mailbox)}/emails`, {
            method: 'POST',
            headers: {
                'CF-Access-Client-Id': clientId,
                'CF-Access-Client-Secret': clientSecret,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                to: email,
                from: { email: mailbox, name: 'BuyWhere' },
                subject: 'Verify your BuyWhere API key — unlocks 10x rate limits',
                text,
                html,
            }),
        });
        if (!resp.ok) {
            console.warn('[email] hub send failed:', resp.status, await resp.text().catch(() => ''));
            return false;
        }
        return true;
    }
    catch (err) {
        console.warn('[email] send error:', err?.message);
        return false;
    }
}
