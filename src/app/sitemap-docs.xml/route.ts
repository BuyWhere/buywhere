import { buildSitemapResponse, getStaticSitemapEntries, renderUrlSet } from "@/lib/sitemaps";

// BUY-70024: dedicated docs sitemap for explicit crawler discovery.
// The docs pages are already included in sitemap-pages.xml too, but a dedicated
// sitemap gives crawlers and answer engines a focused developer-doc URL set.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const entries = await getStaticSitemapEntries();
  const docsEntries = entries.filter(
    (entry) => entry.url.endsWith("/docs") || entry.url.includes("/docs/")
  );

  return buildSitemapResponse(renderUrlSet(docsEntries));
}
