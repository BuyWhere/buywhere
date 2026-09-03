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
