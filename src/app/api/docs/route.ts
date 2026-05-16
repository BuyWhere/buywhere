import { NextRequest } from "next/server";

function buildRedirectUrl(request: NextRequest): string {
  const url = new URL("https://api.buywhere.ai/docs");
  request.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.append(key, value);
  });
  return url.toString();
}

export function GET(request: NextRequest): Response {
  return Response.redirect(buildRedirectUrl(request), 308);
}

export function HEAD(request: NextRequest): Response {
  return Response.redirect(buildRedirectUrl(request), 308);
}
