/**
 * GET /api/health
 *
 * Lightweight site-level liveness probe used by UptimeRobot.
 * Returns 200 with a stable JSON body. The deeper content-level probe lives
 * at /api/health/site.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
      },
    },
  );
}
