// botClass.ts — one classifier for "who is this request from" (truth layer, 2026-08-26).
// Mirrors the site middleware's crawler patterns so clicks, API events and pageviews agree.
import { createHash } from 'crypto';
const BOT_PATTERNS: [RegExp, string][] = [
  [/ChatGPT-User\//i, 'ChatGPT-User'], [/OAI-SearchBot/i, 'OAI-SearchBot'], [/GPTBot/i, 'GPTBot'],
  [/ClaudeBot|anthropic-ai|Claude-Web/i, 'ClaudeBot'], [/PerplexityBot|Perplexity-User/i, 'PerplexityBot'],
  [/Googlebot|Google-Extended|AdsBot-Google/i, 'Googlebot'], [/bingbot/i, 'Bingbot'], [/CCBot/i, 'CCBot'],
  [/Slurp|DuckDuckBot|Baiduspider|YandexBot|AhrefsBot|SemrushBot|Applebot|facebookexternalhit|Twitterbot|LinkedInBot/i, 'other_bot'],
];
const GENERIC_BOT = /\b(bot|crawl|spider|fetch|scrape|headless|selenium|puppeteer|playwright|curl|wget|python-requests|python-urllib|node-fetch|axios|go-http-client|okhttp|java\/)\b/i;
export function classifyUserAgent(ua: string | undefined | null): { isBot: boolean; family: string } {
  const s = ua || '';
  if (!s) return { isBot: true, family: 'bare_ua' };
  for (const [re, family] of BOT_PATTERNS) if (re.test(s)) return { isBot: true, family };
  if (GENERIC_BOT.test(s)) return { isBot: true, family: 'other_bot' };
  return { isBot: false, family: 'human' };
}
export function hashIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  return createHash('sha256').update(ip).digest('hex').slice(0, 32);
}
export function clientIp(req: { headers: Record<string, unknown>; ip?: string; socket?: { remoteAddress?: string } }): string | null {
  const xff = req.headers['x-forwarded-for'];
  const first = Array.isArray(xff) ? xff[0] : (typeof xff === 'string' ? xff.split(',')[0] : '');
  return (first || '').trim() || req.ip || req.socket?.remoteAddress || null;
}
