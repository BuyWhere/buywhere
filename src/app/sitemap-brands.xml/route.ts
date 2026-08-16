import { commerceBrands } from "@/lib/commerce-routes";
import { buildSitemapResponse, renderUrlSet, SITEMAP_BASE_URL } from "@/lib/sitemaps";

export function GET(): Response {
  const now = new Date();

  return buildSitemapResponse(
    renderUrlSet(
      commerceBrands.map((brand) => ({
        url: `${SITEMAP_BASE_URL}/brands/${brand.slug}`,
        lastModified: now,
        changeFrequency: "weekly" as const,
        priority: 0.7,
      }))
    )
  );
}
