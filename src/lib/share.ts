export type ShareChannel = "x" | "whatsapp" | "copy" | "native";

const BUYWHERE_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://buywhere.ai";
const BUYWHERE_API_URL = process.env.NEXT_PUBLIC_BUYWHERE_API_URL || "https://api.buywhere.ai";
const BUYWHERE_API_KEY = process.env.NEXT_PUBLIC_BUYWHERE_API_KEY || "";

interface ShareMessageOptions {
  productName: string;
  priceText?: string | null;
  merchant?: string | null;
  url?: string;
}

interface TrackShareClickOptions {
  productId: number;
  channel: ShareChannel;
  url: string;
}

export function getAbsoluteShareUrl(url?: string): string {
  if (!url) {
    if (typeof window !== "undefined") {
      return window.location.href;
    }

    return BUYWHERE_SITE_URL;
  }

  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  if (typeof window !== "undefined") {
    return new URL(url, window.location.origin).toString();
  }

  return new URL(url, BUYWHERE_SITE_URL).toString();
}

export function buildShareMessage({ productName, priceText, merchant, url }: ShareMessageOptions): string {
  const detailParts = [priceText, merchant].filter(Boolean).join(" on ");
  const teaser = detailParts
    ? `Check out ${productName} for ${detailParts} via @BuyWhere`
    : `Check out ${productName} via @BuyWhere`;

  return `${teaser} ${getAbsoluteShareUrl(url)}`.trim();
}

export function getXShareHref(message: string): string {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}`;
}

export function getWhatsAppShareHref(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

export async function trackShareClick({ productId, channel, url }: TrackShareClickOptions): Promise<void> {
  try {
    await fetch(`${BUYWHERE_API_URL}/v1/events/click`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(BUYWHERE_API_KEY ? { Authorization: `Bearer ${BUYWHERE_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        product_id: productId,
        platform: `share_${channel}`,
        url,
        user_agent: typeof navigator === "undefined" ? undefined : navigator.userAgent,
        type: "share",
      }),
      keepalive: true,
    });
  } catch {
    // Share tracking is opportunistic and should never block the user flow.
  }
}
