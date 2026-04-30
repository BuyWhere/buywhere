import { buildSitemapResponse, getProductSitemapChunk, getProductSitemapChunkCount, renderUrlSet } from "@/lib/sitemaps";

function parsePageNumber(request: Request): number {
  const rawPage = new URL(request.url).searchParams.get("page");
  const page = rawPage ? Number.parseInt(rawPage, 10) : 1;
  return Number.isFinite(page) && page > 0 ? page : 1;
}

export async function GET(request: Request): Promise<Response> {
  const page = parsePageNumber(request);
  let totalPages: number;

  try {
    totalPages = await getProductSitemapChunkCount();
  } catch {
    return new Response("Product sitemap unavailable", { status: 503 });
  }

  if (page > totalPages) {
    return new Response("Not Found", { status: 404 });
  }

  const entries = await getProductSitemapChunk(page);
  return buildSitemapResponse(renderUrlSet(entries));
}
