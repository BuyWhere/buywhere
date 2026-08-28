import posthog from 'posthog-js';

// Curated landing-page product ids (seo-landing-pages.ts) are *not* catalog
// ids — they are static per-page slot identifiers (e.g. "lp1", "g3"). They
// never resolve in `affiliate_links.product_id` or `products.id`, so the /r/
// handler 302s them to the homepage (BUY-76479). Returning null lets the
// caller fall through to its own non-affiliate path (internal search).
//
// All known curated-slot prefixes in seo-landing-pages.ts (audited 2026-08-28):
// ap, f, g, i, lp, m, nc, q, r, sh. Real catalog ids look like "prod_*" or
// long UUID/numeric strings, so a short alpha-prefix + digits pattern is safe.
// New prefixes added to seo-landing-pages.ts MUST be added here too.
const CURATED_SLOT_ID_PATTERN = /^(?:ap|f|g|i|lp|m|nc|q|r|sh)\d+$/i;

function isCuratedSlotId(id: string): boolean {
  return CURATED_SLOT_ID_PATTERN.test(id);
}

/**
 * Build an /r/direct/{id} affiliate redirect URL so the link is
 * server-rendered and crawlable by AI bots (GPTBot, ClaudeBot, etc.).
 * The /r/ route proxies through api.buywhere.ai which 302-redirects
 * to the external retailer URL, giving crawlers a followable path.
 *
 * BUY-75417: AI crawlers could not see retailer links when they were
 * external URLs or client-rendered only.
 *
 * BUY-76479: returns null for curated landing-page slot ids (lp1, g3,
 * featured2, slot7, …) — these never have a real affiliate destination,
 * so the /r/ handler would just 302 to the homepage. Callers fall back to
 * the internal BuyWhere path instead.
 */
export function buildAffiliateRedirectUrl(
  productId: string | number | null | undefined,
): string | null {
  if (productId == null) return null;
  const id = String(productId);
  if (isCuratedSlotId(id)) return null;
  return `/r/direct/${encodeURIComponent(id)}`;
}

function safePostHogSessionId(): string | null {
  try {
    const maybePostHog = posthog as typeof posthog & { get_session_id?: () => string | null };
    return maybePostHog.get_session_id?.() || null;
  } catch {
    return null;
  }
}

export function productCardClickAttributionHref(href: string): string {
  if (typeof window === 'undefined' || !href || href === '#') return href;

  try {
    const url = new URL(href, window.location.origin);
    url.searchParams.set('source', url.searchParams.get('source') || 'product_card');
    url.searchParams.set('pathname', window.location.pathname);
    url.searchParams.set('current_url', `${window.location.pathname}${window.location.search}`);

    if (document.referrer) {
      url.searchParams.set('referrer', document.referrer);
    }

    const sessionId = safePostHogSessionId();
    if (sessionId) {
      url.searchParams.set('session_id', sessionId);
    }

    return url.toString();
  } catch {
    return href;
  }
}

export function attachProductCardClickAttribution(event: React.MouseEvent<HTMLAnchorElement>): void {
  const anchor = event.currentTarget;
  anchor.href = productCardClickAttributionHref(anchor.href);
}
