import { buildSitemapResponse, renderSitemapIndex, SITEMAP_BASE_URL } from "@/lib/sitemaps";

// BUY-65147 follow-up: Railway/Hikari edge cached the prior sitemap.xml body
// for up to 24h despite `Cache-Control: no-store, must-revalidate` because
// Next.js Full Route Cache served a prerendered response. force-dynamic +
// revalidate=0 bypasses that cache so every request re-renders, and the
// runtime: nodejs export avoids any Edge runtime caching layer.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const now = new Date();

  const sitemapEntries = [
    { url: `${SITEMAP_BASE_URL}/sitemap-pages.xml`, lastModified: now },
    { url: `${SITEMAP_BASE_URL}/sitemap-categories.xml`, lastModified: now },
    { url: `${SITEMAP_BASE_URL}/sitemap-compare.xml`, lastModified: now },
    // sitemap-comparisons.xml was removed (BUY-72121 F1): the file was a
    // byte-identical clone of sitemap-compare.xml and /comparisons is 404.
    // Index entries that reference the legacy name will 404.
    { url: `${SITEMAP_BASE_URL}/sitemap-products.xml`, lastModified: now },
    // SG product slug pages return 410 (BUY-37747/BUY-37750), so the
    // dedicated SG product sitemap is intentionally gone. Don't list it in
    // the index to avoid GSC "Sitemap could not be read" coverage errors.
    // Removed from the index per BUY-67478.
    { url: `${SITEMAP_BASE_URL}/sitemap-brands.xml`, lastModified: now },
    { url: `${SITEMAP_BASE_URL}/sitemap-stores.xml`, lastModified: now },
    { url: `${SITEMAP_BASE_URL}/sitemap-docs.xml`, lastModified: now },
    { url: `${SITEMAP_BASE_URL}/sitemap-blog.xml`, lastModified: now },
  ];

  const response = buildSitemapResponse(renderSitemapIndex(sitemapEntries));
  // Belt-and-suspenders: Hikari edge has been observed to serve a stale
  // body even when no-store is set. Vary: * makes the cache key include
  // every request header, so any change to Content-Type or Cache-Control
  // invalidates the edge entry. Combined with no-store this guarantees
  // the next request gets fresh XML.
  response.headers.set("Vary", "*");
  return response;
}
