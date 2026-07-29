import { buildSitemapResponse, renderSitemapIndex, SITEMAP_BASE_URL } from "@/lib/sitemaps";

export async function GET(): Promise<Response> {
  const now = new Date();

  const sitemapEntries = [
    { url: `${SITEMAP_BASE_URL}/sitemap-pages.xml`, lastModified: now },
    { url: `${SITEMAP_BASE_URL}/sitemap-categories.xml`, lastModified: now },
    { url: `${SITEMAP_BASE_URL}/sitemap-compare.xml`, lastModified: now },
    { url: `${SITEMAP_BASE_URL}/sitemap-products.xml`, lastModified: now },
    { url: `${SITEMAP_BASE_URL}/sitemap-products-sg.xml`, lastModified: now },
    { url: `${SITEMAP_BASE_URL}/sitemap-merchants.xml`, lastModified: now },
  ];

  return buildSitemapResponse(renderSitemapIndex(sitemapEntries));
}
