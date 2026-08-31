import { commerceBrands } from "@/lib/commerce-routes";
import { buildSitemapResponse, renderUrlSet, SITEMAP_BASE_URL } from "@/lib/sitemaps";

// BUY-75133 emptied this sitemap while /v1/brand/{slug} returned 404 for every brand.
// 2026-08-28: the brand API is fixed (FTS-narrowed lookup on the replica, ~0.3 s) and the
// pages render real content again, so the 10 brand URLs are restored. lastModified is a
// stable date, not "now" — never fake freshness (indexation directive §5).
const BRANDS_RESTORED = new Date("2026-08-28T05:00:00Z");

export function GET(): Response {
  return buildSitemapResponse(
    renderUrlSet(
      commerceBrands.map((brand) => ({
        url: `${SITEMAP_BASE_URL}/brands/${brand.slug}`,
        lastModified: BRANDS_RESTORED,
        changeFrequency: "weekly" as const,
        priority: 0.7,
      }))
    )
  );
}
