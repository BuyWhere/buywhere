import { buildSitemapResponse, getMerchantListingSitemapEntries, renderUrlSet } from "@/lib/sitemaps";

// Dynamic at the route level (regenerated on every request) so the
// runtime env (BUYWHERE_API_KEY / BUYWHERE_API_INTERNAL_URL) is used —
// the Railway build environment does NOT have those vars, so ISR
// pre-render would hit /v1/merchants unauthenticated and produce an
// empty sitemap (BUY-42890). Rate-limit safety is provided by an
// in-memory cache inside getMerchantListingSitemapEntries
// (see src/lib/sitemaps.ts), keyed by region, TTL 1h, mutex-deduped.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const entries = await getMerchantListingSitemapEntries();
  return buildSitemapResponse(renderUrlSet(entries));
}