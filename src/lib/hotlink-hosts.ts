// BUY-70187: shared hotlink-blocked host list + image-proxy URL helper.
//
// Hosts that reliably serve HTML/403 instead of image bytes when a browser
// or plain server-side fetch requests them (referer/UA bot checks). The SEO
// landing-page data layer used to drop these images outright (branded SVG
// placeholder); instead we now rewrite them through /api/image-proxy, which
// fetches server-side with a browser-like UA and streams the bytes back.
//
// The /search client blocklist (SEARCH_IMAGE_BLOCKED_HOSTS in
// src/app/search/SearchResultsClient.tsx) is intentionally separate — it
// guards a client component that must never emit an <img> for those hosts
// (BUY-72375), and has its own CI guard (search-blocklist-guard.yml).
export const HOTLINK_BLOCKED_HOSTS = new Set([
  "courts.com.sg",
  "www.courts.com.sg",
  "dlcdnwebimgs.asus.com",
  "www.asus.com",
  "shopifycdn.com",
  // BUY-79779: Shopify CDN fails SSR HEAD/GET probes (403/HTML) even when
  // the asset is fetchable with a browser UA. Route through /api/image-proxy.
  "cdn.shopify.com",
  "cdn.shopifycdn.net",
  "images.shopifycdn.com",
  "elescat.store",
  "source.unsplash.com",
  "images.unsplash.com",
  "unsplash.com",
]);

/**
 * True when hostname is an exact blocked host or a subdomain of one.
 */
export function isHotlinkBlockedHostname(hostname?: string | null): boolean {
  if (!hostname) return false;
  const host = hostname.toLowerCase();
  if (HOTLINK_BLOCKED_HOSTS.has(host)) return true;
  for (const blocked of HOTLINK_BLOCKED_HOSTS) {
    if (host.endsWith(`.${blocked}`)) return true;
  }
  return false;
}

/**
 * True when the URL's hostname is a known hotlink-blocked host that
 * /api/image-proxy is allowed to fetch server-side.
 */
export function isHotlinkBlockedHost(imageUrl?: string | null): boolean {
  if (!imageUrl) return false;
  try {
    return isHotlinkBlockedHostname(new URL(imageUrl).hostname);
  } catch {
    return false;
  }
}

/**
 * BUY-70187: rewrite a hotlink-blocked upstream image URL to go through the
 * server-side /api/image-proxy route. Non-blocked URLs pass through
 * unchanged. Returns the input unchanged when it is not a parseable http(s)
 * URL (data: SVG placeholders etc. are handled by the caller).
 */
export function viaImageProxy(imageUrl?: string | null): string | null {
  if (!imageUrl) return null;
  if (imageUrl.startsWith("data:image/svg+xml")) return imageUrl;
  try {
    const url = new URL(imageUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return imageUrl;
    if (!isHotlinkBlockedHostname(url.hostname)) return imageUrl;
    return `/api/image-proxy?url=${encodeURIComponent(imageUrl)}`;
  } catch {
    return imageUrl;
  }
}
