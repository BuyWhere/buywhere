// BUY-67710: Serve the OpenAPI spec at /.well-known/openapi.json by proxying
// from the canonical API endpoint.  Crawlers and AI agents expect this path to
// return valid JSON, not a redirect or 404.

const OPENAPI_UPSTREAM = "https://api.buywhere.ai/openapi.json";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const upstream = await fetch(OPENAPI_UPSTREAM, {
      // Revalidate every hour so spec changes propagate reasonably quickly
      // while still caching aggressively for crawlers.
      next: { revalidate: 3600 },
    });

    if (!upstream.ok) {
      return new Response(
        JSON.stringify({ error: "Upstream OpenAPI spec unavailable" }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    const body = await upstream.text();

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=3600, s-maxage=3600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch OpenAPI spec" }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
}
