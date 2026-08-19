import { NextRequest } from "next/server";

export function GET(_request: NextRequest): Response {
  return Response.json({ status: "ok" }, { status: 200 });
}

export function HEAD(_request: NextRequest): Response {
  return new Response(null, { status: 200 });
}
