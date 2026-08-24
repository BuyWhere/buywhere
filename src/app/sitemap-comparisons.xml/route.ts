import { getCompareSitemapEntries, renderUrlSet, buildSitemapResponse } from "@/lib/sitemaps";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

// Plural alias for /sitemap-compare.xml.
// Search engines and external links occasionally request the plural form;
// serving the same urlset avoids an unnecessary 404 without adding a second
// canonical entry to sitemap-index.xml.
export async function GET(): Promise<Response> {
  const entries = await getCompareSitemapEntries();
  const xml = renderUrlSet(entries);
  return buildSitemapResponse(xml);
}
