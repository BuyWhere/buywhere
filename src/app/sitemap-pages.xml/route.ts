import { buildSitemapResponse, getStaticSitemapEntries, renderUrlSet } from "@/lib/sitemaps";

export async function GET(): Promise<Response> {
  return buildSitemapResponse(renderUrlSet(await getStaticSitemapEntries()));
}
