import {
  buildSitemapResponse,
  renderUrlSet,
  getProductSitemapEntries,
} from "@/lib/sitemaps";

// BUY-65819: sitemap-products.xml must contain US-only product URLs.
// SG product URLs belong in sitemap-products-sg.xml (BUY-65557).
// This restores the baseline of ~100 US-only URLs (23,688B) from mid-July.
// Prior regression: 200 URLs (100 US + 100 SG) with all SG entries 410 Gone.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const usEntries = await getProductSitemapEntries();
  return buildSitemapResponse(renderUrlSet(usEntries));
}
