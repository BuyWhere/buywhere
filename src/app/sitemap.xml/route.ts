import { buildSitemapResponse, getMerchantListingSitemapEntries, getProductSitemapChunkCount, getSGProductSitemapChunkCount, renderSitemapIndex, SITEMAP_BASE_URL } from "@/lib/sitemaps";

export async function GET(): Promise<Response> {
  const now = new Date();
  let productChunkCount = 0;
  let sgProductChunkCount = 0;
  let merchantCount = 0;

  try {
    productChunkCount = await getProductSitemapChunkCount();
  } catch {
    productChunkCount = 0;
  }

  try {
    sgProductChunkCount = await getSGProductSitemapChunkCount();
  } catch {
    sgProductChunkCount = 0;
  }

  try {
    const merchantEntries = await getMerchantListingSitemapEntries();
    merchantCount = merchantEntries.length;
  } catch {
    merchantCount = 0;
  }

  const sitemapEntries = [
    { url: `${SITEMAP_BASE_URL}/sitemap-pages.xml`, lastModified: now },
    { url: `${SITEMAP_BASE_URL}/sitemap-categories.xml`, lastModified: now },
    { url: `${SITEMAP_BASE_URL}/sitemap-compare.xml`, lastModified: now },
    ...(merchantCount > 0
      ? [{ url: `${SITEMAP_BASE_URL}/sitemap-merchants.xml`, lastModified: now }]
      : []),
    ...Array.from({ length: productChunkCount }, (_, index) => {
      const page = index + 1;
      const suffix = page === 1 ? "" : `?page=${page}`;

      return {
        url: `${SITEMAP_BASE_URL}/sitemap-products.xml${suffix}`,
        lastModified: now,
      };
    }),
    ...Array.from({ length: sgProductChunkCount }, (_, index) => {
      const page = index + 1;
      const suffix = page === 1 ? "" : `?page=${page}`;

      return {
        url: `${SITEMAP_BASE_URL}/sitemap-products-sg.xml${suffix}`,
        lastModified: now,
      };
    }),
  ];

  return buildSitemapResponse(renderSitemapIndex(sitemapEntries));
}
