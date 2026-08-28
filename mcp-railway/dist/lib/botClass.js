"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyUserAgent = classifyUserAgent;
exports.hashIp = hashIp;
exports.normalizeIp = normalizeIp;
exports.clientIp = clientIp;
// botClass.ts — one classifier for "who is this request from" (truth layer, 2026-08-26).
// Mirrors the site middleware's crawler patterns so clicks, API events and pageviews agree.
const crypto_1 = require("crypto");
const BOT_PATTERNS = [
    [/ChatGPT-User\//i, 'ChatGPT-User'], [/OAI-SearchBot/i, 'OAI-SearchBot'], [/GPTBot/i, 'GPTBot'],
    [/ClaudeBot|anthropic-ai|Claude-Web/i, 'ClaudeBot'], [/PerplexityBot|Perplexity-User/i, 'PerplexityBot'],
    [/Googlebot|Google-Extended|AdsBot-Google/i, 'Googlebot'], [/bingbot/i, 'Bingbot'], [/CCBot/i, 'CCBot'],
    [/Slurp|DuckDuckBot|Baiduspider|YandexBot|AhrefsBot|SemrushBot|Applebot|facebookexternalhit|Twitterbot|LinkedInBot/i, 'other_bot'],
];
const GENERIC_BOT = /\b(bot|crawl|spider|fetch|scrape|headless|selenium|puppeteer|playwright|curl|wget|python-requests|python-urllib|node-fetch|axios|go-http-client|okhttp|java\/)\b/i;
function classifyUserAgent(ua) {
    const s = ua || '';
    if (!s)
        return { isBot: true, family: 'bare_ua' };
    for (const [re, family] of BOT_PATTERNS)
        if (re.test(s))
            return { isBot: true, family };
    if (GENERIC_BOT.test(s))
        return { isBot: true, family: 'other_bot' };
    return { isBot: false, family: 'human' };
}
function hashIp(ip) {
    const normalized = normalizeIp(ip);
    if (!normalized)
        return null;
    return (0, crypto_1.createHash)('sha256').update(normalized).digest('hex').slice(0, 32);
}
function normalizeIp(ip) {
    if (!ip)
        return null;
    const trimmed = ip.trim();
    if (!trimmed)
        return null;
    return trimmed.startsWith('::ffff:') ? trimmed.slice('::ffff:'.length) : trimmed;
}
function clientIp(req) {
    const xff = req.headers['x-forwarded-for'];
    const first = Array.isArray(xff) ? xff[0] : (typeof xff === 'string' ? xff.split(',')[0] : '');
    return normalizeIp((first || '').trim() || req.ip || req.socket?.remoteAddress || null);
}
