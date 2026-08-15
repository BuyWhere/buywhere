import { buildSitemapResponse, renderUrlSet } from "@/lib/sitemaps";

// BUY-70024: dedicated docs sitemap for explicit crawler discovery.
// The docs pages are already included in sitemap-pages.xml via DOC_SLUGS,
// but a dedicated sitemap improves crawl efficiency for large doc sites.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  // Import DOC_SLUGS from sitemaps lib
  const { getStaticSitemapEntries } = await import("@/lib/sitemaps");
  const entries = getStaticSitemapEntries();

  // Filter to only docs URLs
  const docsEntries = entries.filter((entry) => entry.url.includes("/docs/"));

  return buildSitemapResponse(renderUrlSet(docsEntries));
}
