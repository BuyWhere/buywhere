import {
  buildSitemapResponse,
  renderUrlSet,
  getSGProductSitemapEntries,
} from "@/lib/sitemaps";

// BUY-84237: restore the SG product sitemap now that it emits 2-segment canonical
// URLs (/products/sg/{merchantSlug}/{id}) instead of single-segment slugs.
// The single-segment form (/products/sg/{slug}-{id}) was 410'd by middleware
// (BUY-37750), which is why the previous iteration returned an empty urlset with
// a guard env-var kill-switch. The 2-segment route is allowed through
// (BUY-40757) and the isSGRenderable() filter in sg-products.ts ensures only
// SGD-priced, non-dead, non-foreign-TLD products are listed.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const entries = await getSGProductSitemapEntries();
  if (entries.length === 0) {
    return new Response("Sitemap temporarily unavailable — no products found", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return buildSitemapResponse(renderUrlSet(entries));
}
