import { buildSitemapResponse, getStaticSitemapEntries, renderUrlSet } from "@/lib/sitemaps";

// BUY-72121: exclude /blog/* and /docs/* from sitemap-pages.xml because
// those prefixes are fully owned by sitemap-blog.xml and sitemap-docs.xml.
// Without this filter, the same URLs appear in both files (F2 + F3 duplicates).
export function GET(): Response {
  const allEntries = getStaticSitemapEntries();
  const entries = allEntries.filter(
    (entry) =>
      !entry.url.includes("/blog/") &&
      // /docs listing page is also emitted by sitemap-docs.xml (via endsWith("/docs"))
      !entry.url.includes("/docs/") &&
      !entry.url.endsWith("/docs")
  );
  return buildSitemapResponse(renderUrlSet(entries));
}
