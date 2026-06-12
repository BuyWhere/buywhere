import { buildSitemapResponse, getMerchantListingSitemapEntries, renderUrlSet } from "@/lib/sitemaps";

// ISR: regenerate at most once per hour. Without this, force-dynamic made
// the route uncacheable and the merchant list was re-read from the API on
// every crawler/scraper hit, which tripped the API's per-key rpm limit
// (429s — see BUY-42727 + BUY-42890). 1h cadence is well under Googlebot's
// sitemap-refresh patience and matches the existing cache-control header
// (max-age=3600, s-maxage=3600) emitted by buildSitemapResponse.
export const revalidate = 3600;

export async function GET(): Promise<Response> {
  const entries = await getMerchantListingSitemapEntries();
  return buildSitemapResponse(renderUrlSet(entries));
}
