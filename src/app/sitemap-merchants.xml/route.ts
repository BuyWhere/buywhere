import { buildSitemapResponse, getMerchantListingSitemapEntries, renderUrlSet } from "@/lib/sitemaps";

// Force runtime rendering — merchant list is read from the API at request time
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const entries = await getMerchantListingSitemapEntries();
  return buildSitemapResponse(renderUrlSet(entries));
}
