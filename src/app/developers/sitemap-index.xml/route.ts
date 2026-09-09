// BUY-71599: /developers/sitemap-index.xml is an intended legacy discovery
// entry point, but /sitemap-index.xml is the canonical public sitemap index.
// Keep crawler probes off a 404 while documenting canonical intent via 301.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return Response.redirect(new URL("/sitemap-index.xml", request.url), 301);
}
