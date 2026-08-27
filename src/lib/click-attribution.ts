import posthog from 'posthog-js';

/**
 * Build an /r/direct/{id} affiliate redirect URL so the link is
 * server-rendered and crawlable by AI bots (GPTBot, ClaudeBot, etc.).
 * The /r/ route proxies through api.buywhere.ai which 302-redirects
 * to the external retailer URL, giving crawlers a followable path.
 *
 * BUY-75417: AI crawlers could not see retailer links when they were
 * external URLs or client-rendered only.
 */
export function buildAffiliateRedirectUrl(
  productId: string | number | null | undefined,
): string | null {
  if (productId == null) return null;
  return `/r/direct/${encodeURIComponent(String(productId))}`;
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
