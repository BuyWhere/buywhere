import { buildSitemapResponse, getStaticSitemapEntries, renderUrlSet } from "@/lib/sitemaps";

export function GET(): Response {
  return buildSitemapResponse(renderUrlSet(getStaticSitemapEntries()));
}
