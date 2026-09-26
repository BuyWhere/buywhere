import {
  buildSitemapResponse,
  renderUrlSet,
  getSGProductSitemapEntries,
} from "@/lib/sitemaps";

// BUY-73905: restore a real SG product sitemap. Returning 410 made GSC
// record sitemap fetch errors even though /products/sg/[slug] pages exist.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

// BUY-84237 (2026-09-26): src/middleware.ts answers 410 Gone for EVERY single-segment
// /products/sg/<slug> URL (BUY-37750 thin-page removal), so listing those URLs here
// produced 506 dead sitemap entries per crawl. A sitemap may only list URLs that
// render 200 in this market. Until the SG product page is allowed to render again,
// this child stays a valid 2xx urlset (GSC needs that, BUY-73905) with no entries.
// Set SG_PRODUCT_SITEMAP_ENTRIES=1 once the middleware rule is lifted.
export async function GET(): Promise<Response> {
  if (process.env.SG_PRODUCT_SITEMAP_ENTRIES !== "1") {
    return buildSitemapResponse(renderUrlSet([]));
  }
  const entries = await getSGProductSitemapEntries();
  return buildSitemapResponse(renderUrlSet(entries));
}
