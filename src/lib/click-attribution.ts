import posthog from 'posthog-js';

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
