import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/api-reference" || pathname === "/api-reference/") {
    const url = request.nextUrl.clone();
    url.pathname = "/docs/API_DOCUMENTATION";
    return NextResponse.redirect(url, 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api-reference", "/api-reference/:path*"],
};
