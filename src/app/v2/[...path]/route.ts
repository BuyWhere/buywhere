import { NextRequest } from "next/server";

function buildRedirectUrl(request: NextRequest, path: string[]): string {
  const pathname = path.length > 0 ? `/v2/${path.join("/")}` : "/v2";
  const url = new URL(`https://api.buywhere.ai${pathname}`);
  request.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.append(key, value);
  });
  return url.toString();
}

export function GET(
  request: NextRequest,
  context: { params: { path: string[] } },
): Response {
  return Response.redirect(buildRedirectUrl(request, context.params.path), 308);
}

export function HEAD(
  request: NextRequest,
  context: { params: { path: string[] } },
): Response {
  return Response.redirect(buildRedirectUrl(request, context.params.path), 308);
}
