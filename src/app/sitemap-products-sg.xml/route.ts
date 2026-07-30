import {
  buildSitemapResponse,
  renderUrlSet,
  getSGProductSitemapEntries,
} from "@/lib/sitemaps";

// Force dynamic so the route uses runtime env vars and returns fresh data
// on each request (same pattern as sitemap-products.xml).
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const entries = await getSGProductSitemapEntries();
  return buildSitemapResponse(renderUrlSet(entries));
}
