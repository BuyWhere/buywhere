import { buildSitemapResponse, getProductSitemapChunkCount, renderSitemapIndex, SITEMAP_BASE_URL } from "@/lib/sitemaps";

export async function GET(): Promise<Response> {
  const now = new Date();
  let productChunkCount = 0;

  try {
    productChunkCount = await getProductSitemapChunkCount();
  } catch {
    productChunkCount = 0;
  }

  const sitemapEntries = [
    { url: `${SITEMAP_BASE_URL}/sitemap-pages.xml`, lastModified: now },
    { url: `${SITEMAP_BASE_URL}/sitemap-categories.xml`, lastModified: now },
    { url: `${SITEMAP_BASE_URL}/sitemap-compare.xml`, lastModified: now },
    ...Array.from({ length: productChunkCount }, (_, index) => {
      const page = index + 1;
      const suffix = page === 1 ? "" : `?page=${page}`;

      return {
        url: `${SITEMAP_BASE_URL}/sitemap-products.xml${suffix}`,
        lastModified: now,
      };
    }),
  ];

  return buildSitemapResponse(renderSitemapIndex(sitemapEntries));
}
