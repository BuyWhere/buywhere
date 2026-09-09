import { MetadataRoute } from "next";
import { getUSProducts } from "@/lib/us-products";

const base = "https://buywhere.ai";

export async function GET(): Promise<Response> {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: `${base}/us`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${base}/compare/us`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1.0,
    },
  ];

  const products = await getUSProducts();

  const productRoutes: MetadataRoute.Sitemap = products.map((product) => ({
    url: `${base}/products/us/${product.slug}`,
    lastModified: new Date(product.lastUpdated),
    changeFrequency: "daily" as const,
    priority: 0.8,
  }));

  const sitemap = [...staticRoutes, ...productRoutes];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemap
  .map(
    (entry) => `  <url>
    <loc>${entry.url}</loc>
    <lastmod>${new Date(entry.lastModified || new Date()).toISOString()}</lastmod>
    <changefreq>${entry.changeFrequency}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
