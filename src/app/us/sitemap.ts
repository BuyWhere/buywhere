import { MetadataRoute } from "next";
import { getUSProducts } from "@/lib/us-products";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = "https://buywhere.ai";
  const now = new Date();
  const products = await getUSProducts();

  const routes = [
    { url: "/compare/us", priority: 1.0, changeFrequency: "daily" as const },
    { url: "/us", priority: 0.9, changeFrequency: "weekly" as const },
  ];

  return [
    ...routes.map(({ url, priority, changeFrequency }) => ({
      url: `${base}${url}`,
      lastModified: now,
      changeFrequency,
      priority,
    })),
    ...products.map((product) => ({
      url: `${base}/products/us/${product.slug}`,
      lastModified: new Date(product.lastUpdated),
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
  ];
}
