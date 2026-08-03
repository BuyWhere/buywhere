import { NextResponse } from "next/server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * GET /health
 *
 * Lightweight site-level liveness probe. Returns 200 with a stable JSON body.
 * The deeper content-level probe lives at /api/health/site.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      status: "ok",
      ts: new Date().toISOString(),
      service: "buywhere-site",
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    },
  );
}

export function HEAD(): Response {
  return new Response(null, {
    status: 200,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
