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
  "/docs/getting-started",
  "/docs/authentication",
  "/docs/errors",
  "/docs/api-reference/bulk",
  "/docs/api-reference/categories",
  "/docs/api-reference/compare",
  "/docs/api-reference/deals",
  "/docs/api-reference/get-product",
  "/docs/api-reference/price-history",
  "/docs/api-reference/search",
  "/docs/api-reference/similar",
  "/docs/api-reference/webhooks",
  "/docs/guides/mastra-integration",
  "/docs/guides/mcp-integration",
  "/docs/guides/price-comparison",
]);

const ACTIVE_BLOG_SLUGS = new Set([
  "best-gaming-laptops-us-2026",
  "best-laptop-deals-singapore",
  "best-laptop-deals-singapore-june-2026",
  "best-laptop-deals-under-sgd-2000-singapore",
  "best-price-tracking-tools-singapore",
  "best-robot-vacuums-2026-pricing-compared",
  "best-time-to-buy-cameras",
  "best-time-to-buy-electronics",
  "best-time-to-buy-fitness-tech",
  "best-time-to-buy-headphones",
  "best-time-to-buy-laptops",
  "best-time-to-buy-smartphones",
  "best-time-to-buy-smartwatches",
  "best-time-to-buy-tvs",
  "build-shopping-agent-buywhere-mcp",
  "buywhere-cursor-plugin-launch",
  "cheapest-iphone-17-singapore-june-2026",
  "cheapest-iphone-singapore-2026",
  "cheapest-macbook-air-m3-12-countries-compared",
  "amazon-prime-day-2026-preview",
  "airpods-pro-2-cheapest-us-sg-my-jp",
  "best-time-to-buy-back-to-school-laptops-2026",
  "best-time-to-buy-small-kitchen-appliances-2026",
  "best-noise-cancelling-headphones-2026-bose-sony-sennheiser-apple",
  "buywhere-vs-google-shopping-vs-amazon-pricing-2026",
  "compare-headphones-singapore-2026",
  "compare-product-prices-singapore-2026",
  "fathers-day-deals-2026",
  "home-appliance-deals-singapore-2026",
  "iphone-16-vs-iphone-17-upgrade-worth-it-2026",
  "openai-agents-sdk-buywhere-mcp-tutorial",
  "the-mcp-server-discovery-gap",
  "building-production-mcp-servers",
  "five-mcp-servers-that-earn-context-window",
  "mcp-for-ecommerce",
  "buywhere-mcp-goes-live",
  "mcp-server-ecosystem-2026",
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
  "where-to-buy-airpods-singapore",
  "where-to-buy-apple-watch-singapore",
  "where-to-buy-bose-qc45-singapore",
  "where-to-buy-dji-mini-4-pro-singapore",
  "where-to-buy-dyson-singapore",
  "where-to-buy-dyson-v15-singapore",
  "where-to-buy-fitbit-singapore",
  "where-to-buy-gopro-singapore",
  "where-to-buy-ipad-singapore",
  "where-to-buy-iphone-16-singapore",
  "where-to-buy-iphone-singapore",
  "where-to-buy-kindle-singapore",
  "where-to-buy-laptop-singapore",
  "where-to-buy-logitech-mx-master-singapore",
  "where-to-buy-macbook-air-m3-singapore",
  "where-to-buy-macbook-singapore",
  "where-to-buy-meta-quest-3-singapore",
  "where-to-buy-nintendo-switch-singapore",
  "where-to-buy-ps5-singapore",
  "where-to-buy-roborock-singapore",
  "where-to-buy-samsung-galaxy-s-singapore",
  "where-to-buy-samsung-tv-singapore",
  "where-to-buy-sony-wh-1000xm5-singapore",
  "where-to-buy-steam-deck-singapore",
  "where-to-buy-xbox-series-x-singapore",
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

  if (normalizedPath === "/guides" || normalizedPath.startsWith("/guides/")) {
    return "/docs";
  }

  if (normalizedPath === "/api-reference" || normalizedPath.startsWith("/api-reference/")) {
    return "/docs";
  }

  // BUY-55853: legacy /best-{slug} URLs (no /blog/ prefix) used to 404.  They
  // are blog posts that moved under /blog/, so 301 redirect them to the
  // canonical /blog/{slug} URL.  Only redirect when the slug is currently a
  // live blog post (ACTIVE_BLOG_SLUGS); unknown slugs fall through to the
  // normal 404.  Mirrors the same redirect used for /docs/blog/posts/{slug}.
  if (normalizedPath.startsWith("/best-")) {
    const slug = normalizedPath.slice(1); // strip leading slash, e.g. "best-laptop-deals-singapore"
    if (ACTIVE_BLOG_SLUGS.has(slug)) {
      return `/blog/${slug}`;
    }
  }

  if (normalizedPath.startsWith("/blog/")) {
    const slug = normalizedPath.slice("/blog/".length);
    if (!slug) {
      return isDocsHost ? "/blog" : null;
    }

    return ACTIVE_BLOG_SLUGS.has(slug) ? (isDocsHost ? normalizedPath : null) : (DEAD_BLOG_SLUGS.has(slug) ? null : "__DEAD_BLOG_SLUG__");
  }

  // Real published docs (in ACTIVE_DOC_PATHS) serve directly — checked FIRST so they are not caught by the
  // broad /docs redirects below. Everything else under /docs is internal/old and returns 410 Gone.
  if (normalizedPath.startsWith("/docs") && ACTIVE_DOC_PATHS.has(normalizedPath)) {
    return isDocsHost ? normalizedPath : null;
  }

  if (normalizedPath === "/docs/launch-day-runbook" || normalizedPath === "/docs/launch/launch-day-runbook") {
    return "__GONE__";
  }

  if (normalizedPath === "/docs/quickstart") {
    return "/quickstart";
  }

  if (normalizedPath === "/docs/guides/authentication") {
    return "/api-keys";
  }

  if (normalizedPath === "/docs/guides/rate-limits") {
    return "__GONE__";
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
    return "__GONE__";
  }

  if (normalizedPath.startsWith("/docs/comparisons")) {
    // BUY-37745: legacy product-comparison pages are GONE (no markdown equivalent). Redirecting them
    // to the generic /compare made Google report "Page with redirect" (422) and kept them in index limbo.
    // 410 Gone cleanly de-indexes them (see __GONE__ handling below).
    return "__GONE__";
  }

  if (
    normalizedPath.startsWith("/docs/guides") ||
    normalizedPath.startsWith("/docs/tutorials")
  ) {
    return "__GONE__";
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
    return "__GONE__";
  }

  if (normalizedPath.startsWith("/docs")) {
    if (ACTIVE_DOC_PATHS.has(normalizedPath)) {
      return isDocsHost ? normalizedPath : null;
    }

    return "__GONE__";
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
  // Exception: /developers/robots.txt and /developers/sitemap.xml must reach the rewrite
  // logic below (BUY-65437) — they contain "." but are not real static files.
  const isDeveloperRobotsOrSitemap =
    pathname === "/developers/robots.txt" ||
    pathname === "/developers/robots" ||
    pathname === "/developers/sitemap.xml" ||
    pathname === "/developers/sitemap";
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/assets/") ||
    (pathname.includes(".") && !pathname.startsWith("/docs") && !isDeveloperRobotsOrSitemap) ||
    pathname === "/.well-known/"
  ) {
    return NextResponse.next();
  }

  // BUY-65437: Rewrite /developers/robots.txt -> /robots.txt and /developers/sitemap.xml -> /sitemap.xml
  // The Next.js file-based routing matches .txt/.xml extensions before middleware can rewrite,
  // so we need explicit rewrites for these legacy routes that were working before.
  if (pathname === "/developers/robots.txt" || pathname === "/developers/robots") {
    const url = request.nextUrl.clone();
    url.pathname = "/robots.txt";
    return NextResponse.rewrite(url);
  }
  if (pathname === "/developers/sitemap.xml" || pathname === "/developers/sitemap") {
    const url = request.nextUrl.clone();
    url.pathname = "/sitemap.xml";
    return NextResponse.rewrite(url);
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

  // Dead top-level paths that no longer exist — return 410 Gone so Google stops retrying
  const normalizedForDead = normalizePathname(pathname);
  if (normalizedForDead === "/merchants/join") {
    return new NextResponse(null, { status: 410, headers: { "Content-Type": "text/plain" } });
  }

  // Moved content: product index pages now redirect to their country pages
  if (normalizedForDead === "/products/us") {
    const url = request.nextUrl.clone();
    url.pathname = "/us";
    return NextResponse.redirect(url, 301);
  }
  if (normalizedForDead === "/products/sg") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url, 301);
  }

  // /about now renders src/app/about/page.tsx with title + meta description
  // (see BUY-58440).  Previously this middleware returned 410 (BUY-57869), which
  // suppressed the page even though the page itself shipped the correct metadata.
  // Result: Google indexed /about at avg pos 3.4 with 44 imp / 0 clk (BUY-58440).
  // We now let the page render so Google can pick up <title> + <meta description>.

  // Dead Singapore product slug pages — thin-content pages (Google soft 404 bucket BUY-37750)
  // These pages only render a product name + description with no prices (client-side only).
  // 410 Gone signals permanent removal; Google drops them faster than noindex.
  // New merchant+product detail URLs (/products/sg/merchant/product-id) have 2 path segments
  // after the prefix — allow those through (BUY-40757).
  if (normalizedForDead.startsWith("/products/sg/")) {
    const afterSgPrefix = normalizedForDead.slice("/products/sg/".length);
    if (afterSgPrefix.split("/").filter(Boolean).length <= 1) {
      return new NextResponse(null, { status: 410, headers: { "Content-Type": "text/plain" } });
    }
  }

  // US product slug pages (/products/us/<slug>) — intentionally NOT 410'd.
  // The single-segment route src/app/products/us/[slug]/page.tsx resolves the
  // product from the id suffix and SSR-renders a real price-comparison page
  // (USProductDetail + fetchUSProductSSR), falling back to notFound() (404) for
  // genuinely unknown slugs. Previously this middleware hard-410'd every
  // single-segment US product URL (BUY-40757 thin-content de-index), which left
  // inbound Google-indexed URLs and internal related-product links dead and made
  // every US product detail page read as "410 Gone" (BUY-63952 P0). Mirrors the
  // /about decision (BUY-58440): let the page render real content + metadata so
  // Google can index it, instead of suppressing it with a 410. The richer
  // 2-segment canonical (/products/us/<merchant>/<id>) still renders via its own
  // route and remains the sitemap canonical; SG single-segment slugs stay 410'd
  // above because their page is still client-only thin content.

  // Trailing-slash canonicalisation: 301 redirect to the non-slash URL.
  // GSC flagged 9 URL pairs (BUY-55695) where slash and non-slash variants both
  // returned HTTP 200 and were indexed as duplicates.  The previous rewrite
  // branch served a 200 directly, so both variants stayed in the index.  The
  // legacyRedirectPath check still runs first so /docs/guides/foo/ and
  // unknown /blog/foo/ get 410 / remapped redirects instead of a plain 301.
  if (pathname !== "/" && pathname.endsWith("/")) {
    const nonSlashPath = pathname.slice(0, -1);
    const trailingSlashRedirect = legacyRedirectPath(host, nonSlashPath);
    if (trailingSlashRedirect === "__DEAD_BLOG_SLUG__" || trailingSlashRedirect === "__GONE__") {
      return new NextResponse(null, { status: 410, headers: { "Content-Type": "text/plain" } });
    }
    if (trailingSlashRedirect) {
      const url = request.nextUrl.clone();
      url.host = "buywhere.ai";
      url.port = "";
      url.protocol = "https:";
      url.pathname = trailingSlashRedirect;
      return NextResponse.redirect(url, 301);
    }
    // No legacy remap: 301 to the canonical non-slash URL on the same origin.
    // Emit rel=canonical via Link header so GSC picks up the canonical signal
    // even if the destination page metadata is missing.
    // BUY-57754: construct URL via new URL() rather than request.nextUrl.clone()
    // because the edge-runtime clone preserves the trailing slash from the
    // original request, producing a Location header that still ends with "/"
    // and a self-referencing 301 (e.g. /merchants/ -> /merchants/).  Building
    // a fresh URL from the request's path+search string normalises the
    // pathname correctly.
    const tsResponse = NextResponse.redirect(
      new URL(`${nonSlashPath}${request.nextUrl.search}`, request.url),
      301
    );
    tsResponse.headers.set("Link", `<https://buywhere.ai${nonSlashPath}>; rel="canonical"`);
    return tsResponse;
  }

  const redirectPath = legacyRedirectPath(host, pathname);
  if (redirectPath === "__DEAD_BLOG_SLUG__" || redirectPath === "__GONE__") {
    return new NextResponse(null, { status: 410, headers: { "Content-Type": "text/plain" } });
  }
  if (redirectPath) {
    const url = request.nextUrl.clone();
    url.host = "buywhere.ai";
    url.port = "";
    url.protocol = "https:";
    url.pathname = redirectPath;
    return NextResponse.redirect(url, 301);
  }

  // Intent route rewrites: /best/{query}/{location} and /cheapest/{query}/{location}
  // These expose SEO-friendly URLs that render via the /search page internally.
  const INTENT_LOCATION_MAP: Record<string, string> = {
    singapore: "sg",
    sg: "sg",
    "united-states": "us",
    "united states": "us",
    usa: "us",
    us: "us",
  };

  const bestMatch = pathname.match(/^\/best\/([^/]+)\/([^/]+)\/?$/);
  if (bestMatch) {
    const [, query, rawLocation] = bestMatch;
    const location = INTENT_LOCATION_MAP[rawLocation.toLowerCase()] || rawLocation.toLowerCase();
    const url = request.nextUrl.clone();
    url.pathname = "/search";
    url.search = `q=${encodeURIComponent(query.replace(/-/g, " "))}&country=${encodeURIComponent(location)}`;
    return NextResponse.rewrite(url);
  }

  const cheapestMatch = pathname.match(/^\/cheapest\/([^/]+)\/([^/]+)\/?$/);
  if (cheapestMatch) {
    const [, query, rawLocation] = cheapestMatch;
    const location = INTENT_LOCATION_MAP[rawLocation.toLowerCase()] || rawLocation.toLowerCase();
    const url = request.nextUrl.clone();
    url.pathname = "/search";
    url.search = `q=${encodeURIComponent(query.replace(/-/g, " "))}&country=${encodeURIComponent(location)}`;
    return NextResponse.rewrite(url);
  }

  // BUY-65437: /developers/* and /us/robots/* routes regressed to 404 after
  // BUY-64524 recovery. These legacy SEO/crawler paths have no on-disk route
  // handler; rewrite them to the canonical root handlers so crawlers get a
  // 200 instead of a 404. /developers/robots.txt → /robots.txt, everything
  // else (sitemap-flavoured) → /sitemap.xml.
  if (pathname === "/developers/robots.txt") {
    const url = request.nextUrl.clone();
    url.pathname = "/robots.txt";
    return NextResponse.rewrite(url);
  }
  if (
    pathname === "/developers/sitemap.xml" ||
    pathname === "/developers/robots/sitemap/us" ||
    pathname === "/us/robots/sitemap/us"
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/sitemap.xml";
    return NextResponse.rewrite(url);
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
  // Self-referential canonical via HTTP Link header for /docs/* (BUY-52289): the docs route page
  // metadata is not reliably applied (default <head>, no canonical), so emit canonical via header
  // (Google honours Link rel=canonical). Resolves GSC "Duplicate without user-selected canonical".
  const canonicalPath = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const docsCanonicalLink = pathname.startsWith("/docs") ? `<https://buywhere.ai${canonicalPath}>; rel="canonical"` : null;

  const isDiscoveryRoute =
    pathname === "/" ||
    pathname === "" ||
    pathname === "/docs";

  if (isDiscoveryRoute || docsCanonicalLink) {
    const response = NextResponse.next();
    const linkParts: string[] = [];
    if (isDiscoveryRoute) linkParts.push(DISCOVERY_LINK);
    if (docsCanonicalLink) linkParts.push(docsCanonicalLink);
    response.headers.set("Link", linkParts.join(", "));
    if (isDiscoveryRoute) response.headers.set("Vary", "Accept");
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/:path*"],
};
