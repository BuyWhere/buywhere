import { getCompareSitemapEntries, renderUrlSet, buildSitemapResponse } from "@/lib/sitemaps";

// BUY-70324: Alias route for /sitemap-comparisons.xml (404 gap).
// Historically ~3k comparison-page URLs were announced at this path.
// Mirrors /sitemap-compare.xml — same source, different filename so
// crawlers and GSC property configs that reference the legacy name
// continue to find the corpus.
export const dynamic = "force-dynamic";
export const revalidate = 3600;

export async function GET(): Promise<Response> {
  const entries = await getCompareSitemapEntries();
  const xml = renderUrlSet(entries);
  return buildSitemapResponse(xml);
}
