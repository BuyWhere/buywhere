// Server-side calls from the site to our own API.
// 2026-08-27: brand/deals pages were fetching `${NEXT_PUBLIC_BASE_URL}/api/v1/...` — the site's own rewrite to
// api.buywhere.ai — with NO API key. The API has required a key on /v1/brand(s) and /v1/deals since 24 Aug,
// so every server render got 401 → the pages 404'd (sitemap-brands 10 → 0, 4seen P0). Always call the API
// directly (private Railway hostname when available) with the site's service key.
export function apiBase(): string {
  return process.env.BUYWHERE_API_INTERNAL_URL || "https://api.buywhere.ai";
}
export function apiHeaders(): Record<string, string> {
  const key = process.env.BUYWHERE_API_KEY;
  return key ? { Authorization: `Bearer ${key}` } : {};
}
