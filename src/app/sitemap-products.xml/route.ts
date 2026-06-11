import { buildSitemapResponse, getAllRegionMerchantListingSitemapEntries, renderUrlSet } from "@/lib/sitemaps";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const entries = await getAllRegionMerchantListingSitemapEntries();
  return buildSitemapResponse(renderUrlSet(entries));
}
