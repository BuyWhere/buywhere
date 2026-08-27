import { NextRequest, NextResponse } from "next/server";
import { ACTIVE_BLOG_SLUGS as GENERATED_ACTIVE_BLOG_SLUGS } from "@/lib/active-blog-slugs";
import { isInternalPageview } from "@/lib/pageview-internal";

// BUY-69058: Baseline browser security/privacy headers applied to public HTML routes.
const BASELINE_SECURITY_HEADERS: [string, string][] = [
  // HSTS: Railway terminates TLS at the edge, so we can safely set max-age=1 year with preload.
  // includeSubDomains ensures all subdomains (api, mcp, docs, status) also use HTTPS.
  ["Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload"],
  // Prevent MIME-sniffing attacks: browsers must respect the declared Content-Type.
  ["X-Content-Type-Options", "nosniff"],
  // Clickjacking protection: only allow the site to frame itself.
  ["X-Frame-Options", "SAMEORIGIN"],
  // Referrer privacy: send full URL only on same-origin, origin-only on cross-origin.
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  // Disable unused browser features that could be abused.
  [
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), vr=()",
  ],
  // Content Security Policy: lock down script/style sources while allowing necessary third parties.
  // - 'self' for own origin
  // - 'unsafe-inline' for Next.js hydration and inline JSON-LD schema scripts
  // - Plausible analytics (plausible.io)
  // - Microsoft Clarity (clarity.ms)
  // - Google Tag Manager / Analytics (googletagmanager.com)
  // - PostHog analytics (us.i.posthog.com)
  // - Image CDNs: picsum.photos, unsplash, shopify, amazon, and the full remotePatterns list
  // - connect-src: API endpoints and analytics ingestion
  // - frame-ancestors: prevent embedding in arbitrary iframes
  [
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://plausible.io https://www.clarity.ms https://us-assets.i.posthog.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      // img-src: allow any HTTPS image (merchant product images come from many CDNs)
      "img-src 'self' data: https:",
      // connect-src: API calls, analytics
      "connect-src 'self' https://api.buywhere.ai https://us.i.posthog.com https://us-assets.i.posthog.com https://plausible.io https://www.clarity.ms",
      // frame-ancestors: prevent clickjacking - only self iframing allowed
      "frame-ancestors 'self'",
      // object-src: disable Flash/Java plugins entirely
      "object-src 'none'",
      // base-uri: restrict <base> to self to prevent relative URL hijacking
      "base-uri 'self'",
      // form-action: restrict where forms can submit
      "form-action 'self'",
    ].join("; "),
  ],
];

// BUY-75413 (P2.3): AI agent discovery headers applied to EVERY public response
// on buywhere.ai/* (the apex site). The three always-on headers mirror the
// api.buywhere.ai values so an agent receives the same Agent Card + LLMs-Txt
// regardless of which host it hits. Per the P2.3 spec, X-Agent-Index and
// X-Agent-Auth are NOT emitted on the apex site (no auth/catalog surface).
const AGENT_DISCOVERY_HEADERS: [string, string][] = [
  ["X-Agent-Protocol", "buywhere/v1"],
  ["X-Agent-Card", "https://api.buywhere.ai/.well-known/agent.json"],
  ["X-LLMs-Txt", "https://api.buywhere.ai/llms.txt"],
];

function isHtmlRequest(request: NextRequest): boolean {
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/html") || accept.includes("application/xhtml+xml");
}

function applyBaselineSecurityHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of BASELINE_SECURITY_HEADERS) {
    response.headers.set(key, value);
  }
  return response;
}

// BUY-75413: P2.3 agent-discovery headers are unconditional — applied on every
// middleware-passed-through response on the apex host, not gated by
// isHtmlRequest (the 8-criterion gate measures the full surface).
function applyAgentDiscoveryHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of AGENT_DISCOVERY_HEADERS) {
    response.headers.set(key, value);
  }
  return response;
}

function withBaselineSecurityHeaders(
  request: NextRequest,
  response: NextResponse
): NextResponse {
  if (isHtmlRequest(request)) {
    applyBaselineSecurityHeaders(response);
  }
  // BUY-75413 (P2.3): agent-discovery headers are applied unconditionally,
  // not gated on isHtmlRequest. The P2.3 acceptance gate measures every
  // middleware-passed-through response on buywhere.ai/* — HTML and JSON alike.
  applyAgentDiscoveryHeaders(response);
  return response;
}

/**
 * BUY-75413 (P2.3): wrap ad-hoc NextResponse objects (redirects, rewrites,
 * 4xx shells, 410s, etc.) so they carry the agent-discovery headers before
 * being returned from the middleware function. Mirrors the path-mutation in
 * withBaselineSecurityHeaders but works for explicit responses that bypass
 * the standard NextResponse.next() pipeline.
 */
function tagAgent(response: NextResponse): NextResponse {
  applyAgentDiscoveryHeaders(response);
  return response;
}

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
  ip: string | null,
  cookieHeader: string | null,
  referrer: string | null
) {
  const { is_bot, agent_family } = classifyUa(ua);
  const eventName = "pageview_server";
  // BUY-72699 Defect B: Normalize trailing-slash pathname at capture
  const rawPathname = url.pathname;
  const pathname = normalizePathname(rawPathname);
  // BUY-74987: srv_* is only the server-side distinct_id namespace. Classify
  // internal traffic from path / bot UA / IP / cookie / referrer signals instead.
  const is_internal = isInternalPageview({
    pathname,
    isBot: is_bot,
    ip,
    cookieHeader,
    referrer,
  });
  try {
    await fetch(`${POSTHOG_HOST}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: POSTHOG_KEY,
        event: eventName,
        distinct_id: distinctId,
        properties: {
          $current_url: url.toString(),
          pathname,
          path: pathname + url.search,
          host: url.host,
          $raw_user_agent: ua,
          $ip: ip,
          is_bot,
          agent_family,
          is_internal,
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

const OPTIONAL_METADATA_MISSES: Record<string, { body: string; contentType: string }> = {
  "/security.txt": {
    body: "security.txt is not published for this site.\n",
    contentType: "text/plain; charset=utf-8",
  },
  "/.well-known/security.txt": {
    body: "security.txt is not published for this site.\n",
    contentType: "text/plain; charset=utf-8",
  },
  "/ads.txt": {
    body: "ads.txt is not published for this site.\n",
    contentType: "text/plain; charset=utf-8",
  },
  "/app-ads.txt": {
    body: "app-ads.txt is not published for this site.\n",
    contentType: "text/plain; charset=utf-8",
  },
  "/apple-app-site-association": {
    body: '{"error":"apple-app-site-association is not published for this site."}\n',
    contentType: "application/json; charset=utf-8",
  },
  "/.well-known/apple-app-site-association": {
    body: '{"error":"apple-app-site-association is not published for this site."}\n',
    contentType: "application/json; charset=utf-8",
  },
};

function optionalMetadataMiss(pathname: string): NextResponse | null {
  const miss = OPTIONAL_METADATA_MISSES[pathname];
  if (!miss) return null;

  const response = new NextResponse(miss.body, {
    status: 404,
    headers: {
      "Content-Type": miss.contentType,
      "Cache-Control": "public, max-age=300",
      "X-Robots-Tag": "noindex",
    },
  });
  // BUY-75413 (P2.3): even 404 metadata misses carry the agent-discovery headers.
  applyAgentDiscoveryHeaders(response);
  return response;
}


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

// Generated from content/blog/*.md by scripts/generate-active-blog-slugs.mjs
// before builds so sitemap-blog.xml and middleware cannot drift.
const ACTIVE_BLOG_SLUGS = new Set(GENERATED_ACTIVE_BLOG_SLUGS);

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
 *
 * BUY-74947 (SEO-GATE): the five where-to-buy-* SG posts below were
 * regenerated under BUY-74907 and re-entered the blog canonical surface. They
 * are removed from this deny-list so middleware stops returning 410 for them;
 * the App Router resolves each via generateStaticParams() and they appear in
 * sitemap-blog.xml. Removing dead-slug entries requires a named SEO-GATE
 * ticket per the indexation directive.
 */
const DEAD_BLOG_SLUGS = new Set<string>([]);

function isDeadBlogSlug(pathname: string): boolean {
  const normalized = normalizePathname(pathname);
  if (!normalized.startsWith("/blog/")) return false;
  const slug = normalized.slice("/blog/".length);
  return DEAD_BLOG_SLUGS.has(slug);
}

function legacyRedirectPath(host: string, pathname: string): string | null {
  const normalizedPath = normalizePathname(pathname);
  const isDocsHost = host === "docs.buywhere.ai";

  // BUY-31b6ae66: legal/auth aliases should redirect before the App Router
  // homepage-branded 404 shell can render. Keep here because middleware is the
  // established production redirect path for this app.
  if (normalizedPath === "/legal") {
    return "/privacy";
  }

  if (normalizedPath === "/sign-up") {
    return "/register";
  }

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

  // BUY-64258: legacy robot-vacuum aliases should resolve to the canonical
  // SEO landing page instead of falling through to the generic 404.
  const robotVacuumAlias = {
    "/robot-vacuum": "/best-robot-vacuums-2026",
    "/robot-vacuums": "/best-robot-vacuums-2026",
    "/category/home/robots": "/best-robot-vacuums-2026",
  }[normalizedPath];
  if (robotVacuumAlias) {
    return robotVacuumAlias;
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

    // Deny-list, NOT allow-list. Default-deny against a build-time snapshot is what
    // 410'd 33 live posts for two months (BUY-57626 postmortem, fixed eb14f63) and then
    // again from 2026-08-19 when 554950c reverted it. Unknown slugs fall through to the
    // App Router, which 404s if the article truly does not exist.
    return DEAD_BLOG_SLUGS.has(slug) ? "__DEAD_BLOG_SLUG__" : (isDocsHost ? normalizedPath : null);
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
    return DEAD_BLOG_SLUGS.has(slug) ? "__DEAD_BLOG_SLUG__" : `/blog/${slug}`;
  }

  const apiReferenceAlias = {
    "/docs/api-reference": "/docs/api-reference/search",
    "/docs/api-reference/search-products": "/docs/api-reference/search",
    "/docs/api-reference/find-best-price": "/docs/api-reference/search",
    "/docs/api-reference/get-deals": "/docs/api-reference/deals",
  }[normalizedPath];
  if (apiReferenceAlias) {
    return apiReferenceAlias;
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

export async function middleware(request: NextRequest) {
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
    pathname === "/developers/sitemap" ||
    pathname === "/developers/sitemap-index.xml";
  const metadataMiss = optionalMetadataMiss(pathname);
  if (metadataMiss) {
    return metadataMiss;
  }

  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/assets/") ||
    (pathname.includes(".") && !pathname.startsWith("/docs") && !isDeveloperRobotsOrSitemap) ||
    pathname === "/.well-known/"
  ) {
    return NextResponse.next();
  }

  // BUY-69260: Next.js 14.2.35 throws
  //   "The router state header was sent but could not be parsed."
  // when an RSC navigation request carries a populated Next-Router-State-Tree
  // header. The app-page runtime rejects the request with HTTP 500 before any
  // user code runs — error.tsx can't catch it. PR #473 originally added this
  // strip in commit 27113c030 but the merge into main (12bcfd452) dropped it
  // from src/middleware.ts; live still 500s on the populated __PAGE__ shape
  // that VidMee + BUY-66904 measured. For RSC navigation requests to /search
  // /compare, and /deals, strip the Next-Router-State-Tree header so Next.js falls
  // back to a fresh route render (still 200, still the intended content). The
  // route is force-dynamic + has per-route error.tsx + Promise<searchParams>,
  // so a fresh render is safe.
  const rscFlag = request.headers.get("rsc");
  const routerStateHeader = request.headers.get("next-router-state-tree");
  if (
    rscFlag === "1" &&
    routerStateHeader &&
    (pathname === "/search" || pathname === "/compare" || pathname === "/deals")
  ) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.delete("next-router-state-tree");
    return tagAgent(NextResponse.next({ request: { headers: requestHeaders } }));
  }

  // BUY-65437: Rewrite /developers/robots.txt -> /robots.txt and /developers/sitemap.xml -> /sitemap.xml
  // The Next.js file-based routing matches .txt/.xml extensions before middleware can rewrite,
  // so we need explicit rewrites for these legacy routes that were working before.
  if (pathname === "/developers/robots.txt" || pathname === "/developers/robots") {
    const url = request.nextUrl.clone();
    url.pathname = "/robots.txt";
    return tagAgent(NextResponse.rewrite(url));
  }
  if (pathname === "/developers/sitemap.xml" || pathname === "/developers/sitemap") {
    const url = request.nextUrl.clone();
    url.pathname = "/sitemap.xml";
    return tagAgent(NextResponse.rewrite(url));
  }
  if (pathname === "/developers/sitemap-index.xml") {
    const url = request.nextUrl.clone();
    url.pathname = "/sitemap-index.xml";
    return tagAgent(NextResponse.rewrite(url));
  }


  const ua = request.headers.get("user-agent") ?? "";
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? null;
  const distinctId = ip ? hashIp(ip) : "srv_unknown";
  const cookieHeader = request.headers.get("cookie");
  const referrer = request.headers.get("referer") ?? request.headers.get("referrer");

  capturePageviewServer(distinctId, canonicalRequestUrl(request), ua, ip, cookieHeader, referrer);

  // Dead blog slugs → 410 Gone (clean removal signal for Google, not a redirect)
  if (isDeadBlogSlug(pathname)) {
    return tagAgent(new NextResponse(null, {
      status: 410,
      headers: { "Content-Type": "text/plain" },
    }));
  }

  // Dead top-level paths that no longer exist — return 410 Gone so Google stops retrying
  const normalizedForDead = normalizePathname(pathname);
  if (normalizedForDead === "/merchants/join") {
    return tagAgent(new NextResponse(null, { status: 410, headers: { "Content-Type": "text/plain" } }));
  }

  // BUY-69713: indexable compare aliases must not serve 200 generic/not-found shells.
  // Redirect known utility comparison paths to their canonical, structured pages.
  if (normalizedForDead === "/compare/us/electronics") {
    const url = request.nextUrl.clone();
    url.pathname = "/compare/electronics";
    return tagAgent(NextResponse.redirect(url, 301));
  }
  if (normalizedForDead === "/compare/us/amazon/walmart") {
    const url = request.nextUrl.clone();
    url.pathname = "/compare";
    url.search = "country_code=us&q=amazon%20walmart";
    return tagAgent(NextResponse.redirect(url, 301));
  }

  // Moved content: product index pages now redirect to their country pages
  if (normalizedForDead === "/products/us") {
    const url = request.nextUrl.clone();
    url.pathname = "/us";
    return tagAgent(NextResponse.redirect(url, 301));
  }
  if (normalizedForDead === "/products/sg") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return tagAgent(NextResponse.redirect(url, 301));
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
      return tagAgent(new NextResponse(null, { status: 410, headers: { "Content-Type": "text/plain" } }));
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
      return tagAgent(new NextResponse(null, { status: 410, headers: { "Content-Type": "text/plain" } }));
    }
    if (trailingSlashRedirect) {
      const url = request.nextUrl.clone();
      url.host = "buywhere.ai";
      url.port = "";
      url.protocol = "https:";
      url.pathname = trailingSlashRedirect;
      return tagAgent(NextResponse.redirect(url, 301));
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
    return tagAgent(tsResponse);
  }

  const redirectPath = legacyRedirectPath(host, pathname);
  if (redirectPath === "__DEAD_BLOG_SLUG__" || redirectPath === "__GONE__") {
    return tagAgent(new NextResponse(null, { status: 410, headers: { "Content-Type": "text/plain" } }));
  }
  if (redirectPath) {
    const url = request.nextUrl.clone();
    url.host = "buywhere.ai";
    url.port = "";
    url.protocol = "https:";
    url.pathname = redirectPath;
    return tagAgent(NextResponse.redirect(url, 301));
  }

// BUY-72180: /products/{1-7 digit numeric} hard-404 gate.
  // The [\d{8,}] redirect below only catches 8+ digit IDs. Shorter numeric segments
  // (e.g. /products/1, /products/50, /products/100, /products/250) fall through to
  // /products/[region]/page.tsx, which calls notFound() — but Next.js streams the
  // not-found shell as HTTP 200 (soft-404 anti-pattern). No real BuyWhere product
  // has a <8 digit ID (catalog IDs are 18-digit snowflakes), so 1-7 digit numerics
  // are unambiguously invalid. Return a hard 404 with noindex directly — no API call.
  // Soft-404 risk: crawlers may index 200+empty bodies; sitemap emits only slug-form
  // so the inbound-link surface is narrow but non-zero (older URLs, agent.json, partner
  // feeds, archived sitemaps).
  const productsShortNumericMatch = /^\/products\/(\d{1,7})\/?$/.exec(pathname);
  if (productsShortNumericMatch) {
    // Redirect to /not-found to render the full not-found.tsx page
    const url = request.nextUrl.clone();
    url.pathname = "/not-found";
    return tagAgent(NextResponse.redirect(url, 302));
  }

  // BUY-71642: /products/{numeric-id} soft-404 fix. The route /products/[region]/page.tsx
  // treats numeric ids as "region" and calls getProduct(). When the product is not found,
  // it calls notFound() which returns HTTP 200 (soft-404) - a false-success pattern.
  // This middleware catches numeric-only /products/{id} segments BEFORE Next.js streams
  // the soft-200, and returns a hard 404. The /p/{id} route now serves these products.
  // Restored after BUY-71746 (554950c7) and its follow-up (7f0cd03e) inadvertently
  // dropped the /p/{id} hard-404 + /products/{numeric-id} 308 redirect (BUY-71808).
  const productsNumericMatch = /^\/products\/(\d{8,})\/?$/.exec(pathname);
  if (productsNumericMatch) {
    // Let the page handler determine if it's a real product - this is a known Next.js
    // issue where notFound() doesn't set HTTP status correctly. For now, redirect
    // to the canonical /p/{id} alias where the new route handles it properly.
    // TODO: revert to hard 404 once the [region]/page.tsx notFound() is fixed.
    const productId = productsNumericMatch[1];
    const url = request.nextUrl.clone();
    url.pathname = `/p/${productId}`;
    return tagAgent(NextResponse.redirect(url, 308));
  }

  // BUY-72180: /p/{1-7 digit numeric} hard-404 gate (companion to /products/{short-numeric}).
  // The page handler /p/[productId]/page.tsx (and the [region] page) calls notFound()
  // for short IDs, but notFound() streams as HTTP 200 (soft-404). No real BuyWhere
  // product has a <8 digit ID — return a hard 404 with noindex directly, no API call.
  // BUY-71641: Redirect short /p/{1-7 digit} ids to /not-found. notFound() inside the
  // /p/[id] page streams an empty __next_error__ shell (RSC not-found tree renders
  // null for this dynamic route), so a redirect is the only path that renders the
  // full not-found.tsx page (Header/Footer/styled CTAs). /not-found itself serves
  // HTTP 404, so the hard-404 contract from BUY-72180 is preserved.
  const pShortIdMatch = /^\/p\/(\d{1,7})\/?$/.exec(pathname);
  if (pShortIdMatch) {
    const url = request.nextUrl.clone();
    url.pathname = "/not-found";
    return tagAgent(NextResponse.redirect(url, 302));
  }

  // BUY-71642 gate #3: hard 404 for unknown /p/{id}. The page handler calls
  // notFound() for missing products but Next.js App Router streams the not-found
  // shell as HTTP 200 (soft-404). Middleware runs BEFORE streaming, so we can
  // return a real 404 here. This pre-check bypasses the entire page render.
  // Restored after BUY-71746 (554950c7) and its follow-up (7f0cd03e) inadvertently
  // dropped this gate (BUY-71808).
  //
  // BUY-72409 secondary fix: only 404 on an actual product-not-found (HTTP 404
  // from the API). Transient failures (429 rate-limit, 401/403 auth, 5xx upstream,
  // network timeout) must NOT 404 the PDP — they would otherwise turn the entire
  // short-PDP surface into a 404 wall whenever the monitoring-tier API rate-limits
  // us. On transient failures, fall through and let the page render its own error
  // state (which streams 200 with a soft-error UI, vs a hard 404 that breaks AEO
  // discovery + MCP click_url referrals).
  const pIdMatch = /^\/p\/(\d{8,})\/?$/.exec(pathname);
  if (pIdMatch) {
    const productId = pIdMatch[1];
    // BUY-71641: probe the API; on an actual product-not-found (HTTP 404, not a
    // transient 429/5xx), redirect to /not-found so the full styled 404 page
    // renders. An empty 404 NextResponse (the pre-fix shape) or notFound() in
    // the page both stream a blank __next_error__ shell — the redirect is the
    // only path that renders not-found.tsx. Transient failures fall through to
    // the page handler as before (BUY-72409).
    try {
      const apiRes = await fetch(
        `${process.env.BUYWHERE_API_INTERNAL_URL || "https://api.buywhere.ai"}/v1/products/${encodeURIComponent(productId)}`,
        {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${process.env.BUYWHERE_API_KEY || ""}`,
          },
          signal: AbortSignal.timeout(3000),
        }
      );
      if (apiRes.status === 404) {
        const url = request.nextUrl.clone();
        url.pathname = "/not-found";
        return tagAgent(NextResponse.redirect(url, 302));
      }
    } catch {
      // probe failure/timeout — fall through and let the page render
    }
  }

  // BUY-71653: /p/{id} is the canonical short-alias route. Ensure it passes through
  // to the page handler (no middleware redirect/rewrite needed).
  // This is already handled by the static file bypass above.

  // BUY-75133: /brands/{slug} soft-404 hard-404 gate. The page handler at
  // src/app/brands/[slug]/page.tsx calls notFound() when /api/v1/brand/{slug}
  // returns 404, but Next.js App Router streams the not-found shell as HTTP 200
  // (the same soft-404 anti-pattern that BUY-71642 fixed for /p/{id}). The 10
  // slugs advertised in sitemap-brands.xml (apple, samsung, sony, nike, dyson,
  // nintendo, dell, lenovo, canon, xiaomi) all soft-404 today because the
  // upstream catalog has no brand rows for them — surfacing them in the
  // sitemap burns crawl budget and ChatGPT-User / ClaudeBot fetches return
  // empty bodies. Mirror the /p/{id} pattern: probe the upstream API, and on
  // an actual 404 (NOT transient 429/5xx) return a hard 404 before the page
  // streams. Transient failures fall through and let the page render.
  const brandsSlugMatch = /^\/brands\/([^/]+)\/?$/.exec(pathname);
  if (brandsSlugMatch) {
    const slug = brandsSlugMatch[1];
    try {
      const apiRes = await fetch(
        `${process.env.BUYWHERE_API_INTERNAL_URL || "https://api.buywhere.ai"}/v1/brand/${encodeURIComponent(slug)}`,
        {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${process.env.BUYWHERE_API_KEY || ""}`,
          },
          signal: AbortSignal.timeout(3000),
        }
      );
      if (!apiRes.ok) {
        // Any non-2xx from the upstream brand API (including 500 on non-existent
        // slugs) means no brand data exists for this slug. Return a hard 404
        // rather than letting the page render a 200 soft-404 shell.
        // The upstream /v1/brand/:slug currently returns 500 (not 404) for
        // unknown slugs due to a backend bug — catch all non-OK responses here.
        return tagAgent(new NextResponse(null, {
          status: 404,
          statusText: "Brand Not Found",
          headers: { "X-Robots-Tag": "noindex, nofollow" },
        }));
      }
    } catch {
      // BUY-75133: probe failure OR timeout = no brand data for this slug. The
      // upstream /v1/brand/{slug} hangs ~30s and returns 500 (never a real brand
      // page) for the placeholder slugs that were de-sitemapped in 8d1804055,
      // so the 3s AbortSignal fires here before the 404/500 arrives. Falling
      // through lets the page render a 200 "Temporarily Unavailable" soft-404
      // shell — the anti-pattern this issue fixes. Hard-404 instead. These slugs
      // are permanently non-existent in the catalog, so a hard 404 is honest.
      return tagAgent(new NextResponse(null, {
        status: 404,
        statusText: "Brand Not Found",
        headers: { "X-Robots-Tag": "noindex, nofollow" },
      }));
    }
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
    return withBaselineSecurityHeaders(request, NextResponse.rewrite(url));
  }

  const cheapestMatch = pathname.match(/^\/cheapest\/([^/]+)\/([^/]+)\/?$/);
  if (cheapestMatch) {
    const [, query, rawLocation] = cheapestMatch;
    const location = INTENT_LOCATION_MAP[rawLocation.toLowerCase()] || rawLocation.toLowerCase();
    const url = request.nextUrl.clone();
    url.pathname = "/search";
    url.search = `q=${encodeURIComponent(query.replace(/-/g, " "))}&country=${encodeURIComponent(location)}`;
    return withBaselineSecurityHeaders(request, NextResponse.rewrite(url));
  }

  // BUY-65437: /developers/* and /us/robots/* routes regressed to 404 after
  // BUY-64524 recovery. These legacy SEO/crawler paths have no on-disk route
  // handler; rewrite them to the canonical root handlers so crawlers get a
  // 200 instead of a 404. /developers/robots.txt → /robots.txt, everything
  // else (sitemap-flavoured) → /sitemap.xml.
  if (pathname === "/developers/robots.txt") {
    const url = request.nextUrl.clone();
    url.pathname = "/robots.txt";
    return tagAgent(NextResponse.rewrite(url));
  }
  if (
    pathname === "/developers/sitemap.xml" ||
    pathname === "/developers/robots/sitemap/us" ||
    pathname === "/us/robots/sitemap/us"
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/sitemap.xml";
    return tagAgent(NextResponse.rewrite(url));
  }
  if (pathname === "/developers/sitemap-index.xml") {
    const url = request.nextUrl.clone();
    url.pathname = "/sitemap-index.xml";
    return tagAgent(NextResponse.rewrite(url));
  }

  // Content negotiation: rewrite to dedicated markdown route handlers.
  // Use nextUrl.clone() + pathname assignment (not new URL(path, request.url)) so
  // the rewrite target is always on the same origin, regardless of Host header value.
  if (wantsMarkdown) {
    if (pathname === "/" || pathname === "") {
      const url = request.nextUrl.clone();
      url.pathname = "/index.md";
      return tagAgent(NextResponse.rewrite(url));
    }
    if (pathname === "/docs") {
      const url = request.nextUrl.clone();
      url.pathname = "/docs-md";
      return tagAgent(NextResponse.rewrite(url));
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
    return withBaselineSecurityHeaders(request, response);
  }

  return withBaselineSecurityHeaders(request, NextResponse.next());
}

export const config = {
  matcher: ["/:path*"],
};
