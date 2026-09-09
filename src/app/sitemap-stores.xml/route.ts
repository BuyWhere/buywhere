import { commerceStores } from "@/lib/commerce-routes";
import { buildSitemapResponse, renderUrlSet, SITEMAP_BASE_URL } from "@/lib/sitemaps";

export function GET(): Response {
  const now = new Date();

  return buildSitemapResponse(
    renderUrlSet(
      commerceStores.map((store) => ({
        url: `${SITEMAP_BASE_URL}/stores/${store.slug}`,
        lastModified: now,
        changeFrequency: "weekly" as const,
        priority: 0.7,
      }))
    )
  );
}
