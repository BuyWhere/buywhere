// BUY-75417: server-render outbound affiliate-redirect anchors so AI crawlers
// (OAI-SearchBot, GPTBot, ClaudeBot — JS-off) can see them. The catalog data
// already carries `affiliate_redirect_url` in the form
//   https://buywhere.ai/r/direct/{productId}?source=...
// but the site was rendering it as a raw merchant URL via a client-only
// `window.open` `<span role="button">`. Crawlers that don't execute JS never
// saw the retailer link.
//
// This module exposes two pure helpers so server components can render a real
// `<a href="/r/..." rel="nofollow sponsored" target="_blank">` for every
// merchant CTA. The site's `next.config.mjs` already rewrites `/r/*` to
// `https://api.buywhere.ai/r/*` (lines 400-407), so a relative `/r/...`
// anchor is the canonical outbound path.

// The upstream catalog returns affiliate_redirect_url values rooted at the
// api.buywhere.ai origin (the redirect lives in api/src/routes/redirect.ts
// and is reached via the /r/* rewrite in next.config.mjs). Both are valid
// /r/ URLs — accept either, and reduce to the site-relative /r/... path.
const SITE_HOSTNAMES = new Set([
  "buywhere.ai",
  "www.buywhere.ai",
  "api.buywhere.ai",
]);

/**
 * Normalize an upstream `affiliate_redirect_url` to the relative `/r/...`
 * form. Returns `null` if the input is not a BuyWhere `/r/...` URL — callers
 * must fall back to their normal "no merchant CTA" state.
 *
 * Accepts:
 *   - absolute: "https://buywhere.ai/r/direct/54614597?source=product_card"
 *   - absolute: "https://www.buywhere.ai/r/buywhere/12345?source=..."
 *   - relative: "/r/direct/54614597?source=product_card"
 *
 * Rejects:
 *   - raw merchant URLs (shopee.sg, newegg.com, …) — these leak the
 *     destination to crawlers, defeating the redirect.
 *   - empty / `#` / non-string inputs.
 */
export function buildAffiliateRedirectHref(
  rawHref: string | null | undefined,
): string | null {
  if (!rawHref) return null;
  const trimmed = rawHref.trim();
  if (!trimmed || trimmed === "#") return null;

  // Relative form: must already be on our /r/ path.
  if (trimmed.startsWith("/r/")) {
    return trimmed;
  }

  // Absolute form: must resolve to a buywhere.ai host with a /r/ pathname.
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (!SITE_HOSTNAMES.has(url.hostname.toLowerCase())) return null;
  if (!url.pathname.startsWith("/r/")) return null;

  return `${url.pathname}${url.search}`;
}

/**
 * Build a /r/ direct redirect URL from a product id when the upstream
 * `affiliate_redirect_url` is not present (e.g. SSR price tables whose data
 * comes from `/v1/products/{id}/prices` and only carries raw merchant URLs).
 *
 * Format: `/r/direct/{productId}?source={source}`
 */
export function buildAffiliateRedirectFromProductId(
  productId: string | number,
  source: string,
): string {
  return `/r/direct/${encodeURIComponent(String(productId))}?source=${encodeURIComponent(source)}`;
}
