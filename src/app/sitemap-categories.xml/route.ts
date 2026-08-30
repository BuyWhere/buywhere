import { buildSitemapResponse, getCategorySitemapEntries, renderUrlSet } from "@/lib/sitemaps";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const response = buildSitemapResponse(renderUrlSet(await getCategorySitemapEntries()));
  response.headers.set("Vary", "*");
  return response;
}
