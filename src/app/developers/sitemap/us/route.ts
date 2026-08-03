import { buildSitemapResponse, getMerchantListingSitemapEntries, renderUrlSet } from "@/lib/sitemaps";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const entries = await getMerchantListingSitemapEntries();
  return buildSitemapResponse(renderUrlSet(entries));
}
