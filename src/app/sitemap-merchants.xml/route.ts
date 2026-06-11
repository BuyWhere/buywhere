import { buildSitemapResponse, getMerchantListingSitemapEntries, renderUrlSet } from "@/lib/sitemaps";

export async function GET(): Promise<Response> {
  const entries = await getMerchantListingSitemapEntries();
  return buildSitemapResponse(renderUrlSet(entries));
}
