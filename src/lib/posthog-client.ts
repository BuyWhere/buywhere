import posthog from "posthog-js";

type CaptureProps = Record<string, unknown>;

/**
 * BUY-79258: posthog-js queues internally only after init. Our provider defers
 * init past hydration, so early capture() calls (and AnalyticsTracker on first
 * paint) used to drop on `!posthog.__loaded`. Buffer until the SDK is ready.
 */
const pending: Array<{ event: string; properties?: CaptureProps }> = [];
let flushing = false;

export function flushPosthogQueue(): void {
  if (flushing) return;
  flushing = true;
  try {
    while (pending.length > 0 && posthog.__loaded) {
      const next = pending.shift();
      if (!next) break;
      posthog.capture(next.event, next.properties);
    }
  } finally {
    flushing = false;
  }
}

export function captureWhenReady(event: string, properties?: CaptureProps): void {
  if (typeof window === "undefined") return;
  try {
    if (posthog.__loaded) {
      posthog.capture(event, properties);
      return;
    }
    pending.push({ event, properties });
  } catch {
    // never block navigation / render
  }
}

export function productCardClickProperties(input: {
  href: string;
  productId?: string | number | null;
  merchantId?: string | null;
  affiliateLinkId?: string | null;
}): CaptureProps {
  const pathname = typeof window !== "undefined" ? window.location.pathname : "";
  const currentUrl = typeof window !== "undefined" ? window.location.href : "";
  const referrer = typeof document !== "undefined" ? document.referrer : "";
  let sessionId: string | null = null;
  try {
    sessionId =
      (posthog as typeof posthog & { get_session_id?: () => string | null }).get_session_id?.() ||
      null;
  } catch {
    sessionId = null;
  }

  return {
    source: "product_card",
    product_id: input.productId != null ? String(input.productId) : "",
    merchant_id: input.merchantId || "",
    affiliate_link_id: input.affiliateLinkId || "",
    href: input.href,
    pathname,
    $pathname: pathname,
    current_url: currentUrl,
    $current_url: currentUrl,
    ...(referrer ? { referrer, $referrer: referrer } : {}),
    ...(sessionId ? { session_id: sessionId, $session_id: sessionId } : {}),
  };
}

/** Intent KPI + historical affiliate_click name used by /r/ server capture. */
export function captureProductCardClick(input: {
  href: string;
  productId?: string | number | null;
  merchantId?: string | null;
  affiliateLinkId?: string | null;
}): void {
  const properties = productCardClickProperties(input);
  captureWhenReady("product_card_click", properties);
  captureWhenReady("affiliate_click", properties);
}
