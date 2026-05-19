import { NextRequest, NextResponse } from "next/server";

// Discovery Link headers for AI agent / Cloudflare readiness
const DISCOVERY_LINK =
  '<https://buywhere.ai/llms.txt>; rel="describedby"; type="text/plain", ' +
  '<https://buywhere.ai/.well-known/api-catalog>; rel="service-desc"; type="application/json", ' +
  '<https://buywhere.ai/.well-known/mcp/server-card.json>; rel="service-desc"; type="application/json", ' +
  '<https://buywhere.ai/openapi.json>; rel="service-desc"; type="application/json"';

const ACTIVE_DOC_PATHS = new Set([
  "/docs",
  "/docs/API_DOCUMENTATION",
  "/docs/quickstart-mcp",
  "/docs/developer-quickstart-sea-shopping-agent",
  "/docs/agent-onboarding-flow",
  "/docs/rate-limits",
  "/docs/BUY-7268-status",
  "/docs/BUY-14348-status",
  "/docs/launch-runbook",
  "/docs/smithery-publish-guide",
  "/docs/uptime-monitoring-setup",
]);

const ACTIVE_BLOG_SLUGS = new Set([
  "best-laptop-deals-singapore",
  "best-price-tracking-tools-singapore",
  "best-time-to-buy-cameras",
  "best-time-to-buy-electronics",
  "best-time-to-buy-fitness-tech",
  "best-time-to-buy-headphones",
  "best-time-to-buy-laptops",
  "best-time-to-buy-smartwatches",
  "best-time-to-buy-tvs",
]);

function normalizePathname(pathname: string): string {
  if (pathname === "/") {
    return pathname;
  }

  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function legacyRedirectPath(host: string, pathname: string): string | null {
  const normalizedPath = normalizePathname(pathname);
  const isDocsHost = host === "docs.buywhere.ai";

  if (normalizedPath === "/api-keys-keys") {
    return "/api-keys";
  }

  if (normalizedPath === "/alerts") {
    return "/search";
  }

  if (normalizedPath === "/changelog") {
    return "/blog";
  }

  if (normalizedPath.startsWith("/blog/")) {
    const slug = normalizedPath.slice("/blog/".length);
    if (!slug) {
      return isDocsHost ? "/blog" : null;
    }

    return ACTIVE_BLOG_SLUGS.has(slug) ? (isDocsHost ? normalizedPath : null) : "/blog";
  }

  if (normalizedPath === "/docs/launch-day-runbook" || normalizedPath === "/docs/launch/launch-day-runbook") {
    return "/docs/launch-runbook";
  }

  if (normalizedPath === "/docs/quickstart" || normalizedPath === "/docs/getting-started") {
    return "/quickstart";
  }

  if (normalizedPath === "/docs/guides/authentication") {
    return "/api-keys";
  }

  if (normalizedPath === "/docs/guides/rate-limits") {
    return "/docs/rate-limits";
  }

  if (normalizedPath.startsWith("/docs/blog/posts/")) {
    const slug = normalizedPath.slice("/docs/blog/posts/".length);
    return ACTIVE_BLOG_SLUGS.has(slug) ? `/blog/${slug}` : "/blog";
  }

  if (
    normalizedPath === "/docs/api" ||
    normalizedPath === "/docs/api/reference" ||
    normalizedPath.startsWith("/docs/api-reference")
  ) {
    return "/docs/API_DOCUMENTATION";
  }

  if (normalizedPath.startsWith("/docs/comparisons")) {
    return "/compare";
  }

  if (
    normalizedPath.startsWith("/docs/guides") ||
    normalizedPath.startsWith("/docs/tutorials")
  ) {
    return "/quickstart";
  }

  if (
    normalizedPath.startsWith("/docs/bd") ||
    normalizedPath.startsWith("/docs/content") ||
    normalizedPath.startsWith("/docs/emails") ||
    normalizedPath.startsWith("/docs/index") ||
    normalizedPath.startsWith("/docs/knowledge-base") ||
    normalizedPath.startsWith("/docs/pipelines") ||
    normalizedPath.startsWith("/docs/recipes") ||
    normalizedPath.startsWith("/docs/samples") ||
    normalizedPath.startsWith("/docs/social")
  ) {
    return "/docs";
  }

  if (normalizedPath.startsWith("/docs")) {
    if (ACTIVE_DOC_PATHS.has(normalizedPath)) {
      return isDocsHost ? normalizedPath : null;
    }

    return "/docs";
  }

  if (isDocsHost) {
    return normalizedPath === "/" ? "/docs" : normalizedPath;
  }

  return null;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host") || "";
  const accept = request.headers.get("accept") ?? "";
  const wantsMarkdown = accept.includes("text/markdown");

  // Bypass all middleware for static files
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/assets/") ||
    pathname.includes(".") ||
    pathname === "/.well-known/"
  ) {
    return NextResponse.next();
  }

  const redirectPath = legacyRedirectPath(host, pathname);
  if (redirectPath) {
    const url = request.nextUrl.clone();
    url.host = "buywhere.ai";
    url.port = "";
    url.protocol = "https:";
    url.pathname = redirectPath;
    return NextResponse.redirect(url, 308);
  }

  // Content negotiation: rewrite to dedicated markdown route handlers.
  // Use nextUrl.clone() + pathname assignment (not new URL(path, request.url)) so
  // the rewrite target is always on the same origin, regardless of Host header value.
  if (wantsMarkdown) {
    if (pathname === "/" || pathname === "") {
      const url = request.nextUrl.clone();
      url.pathname = "/index.md";
      return NextResponse.rewrite(url);
    }
    if (pathname === "/docs") {
      const url = request.nextUrl.clone();
      url.pathname = "/docs-md";
      return NextResponse.rewrite(url);
    }
  }

  // Add discovery Link headers and Vary: Accept for HTML responses on / and /docs/
  const isDiscoveryRoute =
    pathname === "/" ||
    pathname === "" ||
    pathname === "/docs";

  if (isDiscoveryRoute) {
    const response = NextResponse.next();
    response.headers.set("Link", DISCOVERY_LINK);
    response.headers.set("Vary", "Accept");
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/:path*"],
};
