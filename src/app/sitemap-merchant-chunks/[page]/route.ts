import {
  buildSitemapResponse,
  getMerchantSitemapChunk,
  renderUrlSet,
} from "@/lib/sitemaps";

// BUY-72819: Individual merchant sitemap chunks.
// sitemap-merchant-chunks/0.xml, sitemap-merchant-chunks/1.xml, etc.
// Each chunk contains up to MAX_URLS_PER_SITEMAP (50K) merchant listing URLs.
// The parent sitemap-merchants.xml returns a sitemap index that references these chunks.
// Uses a URL path that avoids conflict with the static sitemap-merchants.xml route.
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: { page: string } }
): Promise<Response> {
  void request;
  const { page } = params;
  const pageNum = parseInt(page, 10);

  if (isNaN(pageNum) || pageNum < 1) {
    return new Response("Not Found", { status: 404 });
  }

  const entries = await getMerchantSitemapChunk(pageNum);
  return buildSitemapResponse(renderUrlSet(entries));
}
