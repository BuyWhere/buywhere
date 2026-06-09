import { NextRequest, NextResponse } from "next/server";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "phc_B3cS3aNdwTfr2UMykvuShWNnnTaPf5sfHLUQ8FkNHqCc";
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

const BOT_PATTERNS: [RegExp, string][] = [
  [/\bChatGPT-User\//i, "ChatGPT-User"],
  [/\bClaudeBot\//i, "ClaudeBot"],
  [/\bPerplexityBot\//i, "PerplexityBot"],
  [/\bGPTBot\//i, "GPTBot"],
  [/\bGoogle-Extended\//i, "Google-Extended"],
  [/\banthropic-ai\//i, "anthropic-ai"],
  [/\bCCBot\//i, "CCBot"],
  [/\bGooglebot\b/i, "Googlebot"],
  [/\bBingbot\b/i, "Bingbot"],
  [/\bSlurp\b/i, "other_bot"],
  [/\bDuckDuckBot\b/i, "other_bot"],
  [/\bBaiduspider\b/i, "other_bot"],
  [/\bYandexBot\b/i, "other_bot"],
  [/\bAhrefsBot\b/i, "other_bot"],
  [/\bSemrushBot\b/i, "other_bot"],
];

const GENERIC_BOT_RE = /\b(bot|crawl|spider|fetch|scrape|headless|selenium|puppeteer|playwright|curl|wget|python-requests|node-fetch|axios)\b/i;

function classifyUa(ua: string): { is_bot: boolean; agent_family: string } {
  for (const [re, family] of BOT_PATTERNS) {
    if (re.test(ua)) return { is_bot: true, agent_family: family };
  }
  if (GENERIC_BOT_RE.test(ua)) return { is_bot: true, agent_family: "other_bot" };
  return { is_bot: false, agent_family: "human" };
}

async function capturePageviewServer(
  distinctId: string,
  url: URL,
  ua: string,
  ip: string | null
) {
  const { is_bot, agent_family } = classifyUa(ua);
  try {
    await fetch(`${POSTHOG_HOST}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: POSTHOG_KEY,
        event: "pageview_server",
        distinct_id: distinctId,
        properties: {
          $current_url: url.toString(),
          pathname: url.pathname,
          path: url.pathname + url.search,
          host: url.host,
          $raw_user_agent: ua,
          $ip: ip,
          is_bot,
          agent_family,
        },
      }),
    });
  } catch {}
}

function canonicalRequestUrl(request: NextRequest): URL {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host") || request.nextUrl.host;
  const proto = forwardedProto || request.nextUrl.protocol.replace(":", "");
  const url = new URL(request.nextUrl.pathname + request.nextUrl.search, `${proto}://${host}`);
  return url;
}

function hashIp(ip: string): string {
  let h = 0;
  for (let i = 0; i < ip.length; i++) {
    h = ((h << 5) - h + ip.charCodeAt(i)) | 0;
  }
  return "srv_" + Math.abs(h).toString(36);
}

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
  "best-laptop-deals-under-sgd-2000-singapore",
  "best-price-tracking-tools-singapore",
  "best-time-to-buy-cameras",
  "best-time-to-buy-electronics",
  "best-time-to-buy-fitness-tech",
  "best-time-to-buy-headphones",
  "best-time-to-buy-laptops",
  "best-time-to-buy-smartwatches",
  "best-time-to-buy-tvs",
  "cheapest-iphone-singapore-2026",
  "compare-headphones-singapore-2026",
  "compare-product-prices-singapore-2026",
  "home-appliance-deals-singapore-2026",
]);

function normalizePathname(pathname: string): string {
  if (pathname === "/") {
    return pathname;
  }

  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/**
 * Dead blog slugs — URLs that were once valid articles but the content has been
 * removed.  Google Search Console treats a 308→/blog redirect as "Page with
 * redirect" which keeps the URL in the index indefinitely.  Returning 410 Gone
 * tells Google to drop the URL cleanly.
 */
const DEAD_BLOG_SLUGS = new Set([
  "where-to-buy-ps5-singapore",
  "where-to-buy-xbox-series-x-singapore",
  "where-to-buy-nintendo-switch-singapore",
  "where-to-buy-airpods-singapore",
  "where-to-buy-macbook-singapore",
  "where-to-buy-ipad-singapore",
  "where-to-buy-samsung-galaxy-s-singapore",
  "where-to-buy-dyson-singapore",
  "where-to-buy-iphone-singapore",
  "where-to-buy-fitbit-singapore",
  "where-to-buy-apple-watch-singapore",
  "where-to-buy-gopro-singapore",
  "where-to-buy-sony-wh-1000xm5-singapore",
  "where-to-buy-kindle-singapore",
  "where-to-buy-samsung-tv-singapore",
  "where-to-buy-roborock-singapore",
  "where-to-buy-dyson-v15-singapore",
  "where-to-buy-bose-qc45-singapore",
  "where-to-buy-logitech-mx-master-singapore",
  "where-to-buy-steam-deck-singapore",
  "where-to-buy-meta-quest-3-singapore",
]);

function isDeadBlogSlug(pathname: string): boolean {
  const normalized = normalizePathname(pathname);
  if (!normalized.startsWith("/blog/")) return false;
  const slug = normalized.slice("/blog/".length);
  return DEAD_BLOG_SLUGS.has(slug);
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

    return ACTIVE_BLOG_SLUGS.has(slug) ? (isDocsHost ? normalizedPath : null) : (DEAD_BLOG_SLUGS.has(slug) ? null : "__DEAD_BLOG_SLUG__");
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
    return ACTIVE_BLOG_SLUGS.has(slug) ? `/blog/${slug}` : "__DEAD_BLOG_SLUG__";
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

  const ua = request.headers.get("user-agent") ?? "";
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? null;
  const distinctId = ip ? hashIp(ip) : "srv_unknown";

  capturePageviewServer(distinctId, canonicalRequestUrl(request), ua, ip);

  // Dead blog slugs → 410 Gone (clean removal signal for Google, not a redirect)
  if (isDeadBlogSlug(pathname)) {
    return new NextResponse(null, {
      status: 410,
      headers: { "Content-Type": "text/plain" },
    });
  }

  // Trailing-slash rewrite: serve the non-slash path directly (200) instead of
  // letting Next.js emit a 308 redirect.  Google was seeing 308 on every
  // trailing-slash URL and reporting "Page with redirect", preventing indexing.
  if (pathname !== "/" && pathname.endsWith("/")) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.slice(0, -1);
    return NextResponse.rewrite(url);
  }

  const redirectPath = legacyRedirectPath(host, pathname);
  if (redirectPath === "__DEAD_BLOG_SLUG__") {
    return new NextResponse(null, { status: 410, headers: { "Content-Type": "text/plain" } });
  }
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
