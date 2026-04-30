import { buildSitemapResponse, getCategorySitemapEntries, renderUrlSet } from "@/lib/sitemaps";

export function GET(): Response {
  return buildSitemapResponse(renderUrlSet(getCategorySitemapEntries()));
}
