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
  "elescat.store",
  "source.unsplash.com",
  "images.unsplash.com",
  "unsplash.com",
]);

// BUY-70558 / BUY-70340: Akamai-backed product image CDNs that reject SSR
// HEAD probes without browser referer context, but render in the browser when
// no referrer is sent. Treat them as reachable at SSR and use the same
// /api/image-proxy path as other hotlink-sensitive hosts; if the upstream is
// truly dead, ProductGridImage's onError placeholder remains the fallback.
export const REFERER_GATED_HOSTS = new Set([
  "c1.neweggimages.com",
]);

/**
 * True when the URL's hostname is a known hotlink-blocked host that
 * /api/image-proxy is allowed to fetch server-side.
 */
export function isHotlinkBlockedHost(imageUrl?: string | null): boolean {
  if (!imageUrl) return false;
  try {
    const hostname = new URL(imageUrl).hostname;
    return HOTLINK_BLOCKED_HOSTS.has(hostname) || REFERER_GATED_HOSTS.has(hostname);
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
    if (!HOTLINK_BLOCKED_HOSTS.has(url.hostname) && !REFERER_GATED_HOSTS.has(url.hostname)) return imageUrl;
    return `/api/image-proxy?url=${encodeURIComponent(imageUrl)}`;
  } catch {
    return imageUrl;
  }
}
