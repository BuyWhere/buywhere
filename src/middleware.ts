import { NextRequest, NextResponse } from "next/server";
import { isCanonicalRouterStateTree } from "@/lib/router-state-tree";
import { commerceBrands, commerceStores } from "@/lib/commerce-routes";
import { ACTIVE_COMPARE_STATIC_SLUGS, PRODUCT_TAXONOMY } from "@/lib/taxonomy";
import { COMPARE_DOC_SLUGS } from "@/lib/compare-doc-slugs";

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

function withBaselineSecurityHeaders(
  request: NextRequest,
  response: NextResponse
): NextResponse {
  if (isHtmlRequest(request)) {
    applyBaselineSecurityHeaders(response);
  }
  return response;
}

// BUY-71735: P2.3 — Add X-Agent-Auth header on 401/403 auth failures.
// Also ensures Access-Control-Expose-Headers includes all five agent headers.
function withAgentAuthHeader(request: NextRequest, response: NextResponse): NextResponse {
  const status = response.status;
  if (status === 401 || status === 403) {
    response.headers.set(
      "X-Agent-Auth",
      "Bearer; register=https://buywhere.ai/api-keys"
    );
  }

  // Ensure Access-Control-Expose-Headers includes all five headers for browser agents.
  const existingExpose = response.headers.get("Access-Control-Expose-Headers");
  const allFive = "X-Agent-Protocol, X-Agent-Card, X-LLMs-Txt, X-Agent-Index, X-Agent-Auth";
  if (existingExpose) {
    // Append if not already present
    if (!existingExpose.includes("X-Agent-Protocol")) {
      response.headers.set("Access-Control-Expose-Headers", `${existingExpose}, ${allFive}`);
    }
  } else {
    response.headers.set("Access-Control-Expose-Headers", allFive);
  }

  return response;
}

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "phc_B3cS3aNdwTfr2UMykvuShWNnnTaPf5sfHLUQ8FkNHqCc";
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

const BOT_PATTERNS: [RegExp, string][] = [
  // BUY-70970: Expanded bot patterns for is_bot classifier accuracy
  // Priority: specific crawlers first, then generic patterns
  [/\bUptimeRobot\b/i, "UptimeRobot"], // 38% of "human" traffic - primary noise source
  [/\bHeadlessChrome\b/i, "HeadlessChrome"], // Common testing/automation tool
  [/\bChrome-Headless\b/i, "HeadlessChrome"],
  [/\bPaperclip-Heartbeat\b/i, "Paperclip"],
  [/\bSketchAudit\b/i, "SketchAudit"],
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
  [/\bfacebookexternalhit\b/i, "other_bot"],
  [/\bTwitterbot\b/i, "other_bot"],
  [/\bLinkedInBot\b/i, "other_bot"],
  [/\bMJ12bot\b/i, "other_bot"],
  [/\bDotBot\b/i, "other_bot"],
  [/\bBytespider\b/i, "other_bot"],
  [/\bApplebot\b/i, "other_bot"],
  [/\bPetalBot\b/i, "other_bot"],
];

// BUY-70970: generic catch-all for *bot*, *Bot*, *crawler*, *spider*, etc. Does NOT require a
// leading word boundary so "FooBarBot" and "FooBot/1.0" are still caught.
const GENERIC_BOT_RE = /(bot|crawl|spider|fetch|scrape|headless|selenium|puppeteer|playwright|curl|wget|python-requests|python-urllib|node-fetch|axios|java|go-http|http\.rb|okhttp|postman|insomnia)/i;

function classifyUa(ua: string): { is_bot: boolean; agent_family: string } {
  // BUY-70970: Bare "Mozilla/5.0" with no product token is a synthetic default UA
  if (ua.trim() === "Mozilla/5.0") {
    return { is_bot: true, agent_family: "bare_ua" };
  }
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
  // BUY-70970: collapse trailing slashes so /developers and /developers/ aggregate together
  const pathname =
    url.pathname !== "/" && url.pathname.endsWith("/")
      ? url.pathname.slice(0, -1)
      : url.pathname;
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
          pathname,
          path: pathname + url.search,
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

  return new NextResponse(miss.body, {
    status: 404,
    headers: {
      "Content-Type": miss.contentType,
      "Cache-Control": "public, max-age=300",
      "X-Robots-Tag": "noindex",
    },
  });
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
// ⚠️ GUARD (BUY-57626 postmortem): this is the ONLY list allowed to 410 blog
// URLs, and it must stay short, explicit, and human-reviewed. Adding a slug
// here tells Google to PERMANENTLY drop the page. The 2026-06..08 incident:
// a default-deny allowlist deindexed 33 commercial pages for 2 months. Do not
// "optimise" the blog gate back to an allowlist.
//
// BUY-71017 (tier 2, 2026-08-18): all 17 commercial where-to-buy-* slugs now
// have content under content/blog/, so the App Router will serve 200. Pruned
// the entire DEAD set to allow Google to re-crawl them. If a future restore
// is needed, add the slug here ONLY if content cannot be recovered.
const DEAD_BLOG_SLUGS: Set<string> = new Set([]);

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

  // BUY-70738: legacy /api-reference/{slug} aliases were returning 200 skeleton shells.
  // Redirect to canonical /docs/ or /docs/api-reference/ pages.
  const apiReferenceSlug = {
    "/api-reference/authentication": "/docs/authentication",
    "/api-reference/errors": "/docs/errors",
    "/api-reference/search": "/docs/api-reference/search",
    "/api-reference/products": "/docs/api-reference/get-product",
    "/api-reference/recommendations": "/docs/api-reference/similar",
  }[normalizedPath];
  if (apiReferenceSlug) {
    return apiReferenceSlug;
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

    // ⚠️ GUARD (BUY-57626 postmortem, 2026-08-18): DO NOT reintroduce
    // default-deny here. A previous version 410'd every slug not on the static
    // ACTIVE_BLOG_SLUGS list — but posts are also published OUTSIDE this repo
    // (4seen publishing system, generated commercial pages), so 33 live
    // commercial/developer posts returned 410 for ~2 months and were deindexed
    // by Google. Explicit DEAD_BLOG_SLUGS (checked via isDeadBlogSlug) is the
    // ONLY thing allowed to 410 a blog URL. Unknown slugs MUST fall through to
    // the app, which hard-404s naturally (BUY-70666) if truly absent.
    return isDocsHost ? normalizedPath : null;
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
    // BUY-57626 guard: redirect every non-dead slug to /blog/<slug>; the app
    // 404s unknowns. Never default-deny (see the /blog/ branch above).
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

  // BUY-70108: explicit redirects for /docs/sdks and /docs/examples
  // These were returning 410 because the catch-all /docs check below fires
  // before next.config.mjs redirects. Handle them here with 301 redirects.
  const docsRedirectAlias = {
    "/docs/sdks": "/developers",
    "/docs/examples": "/docs",
  }[normalizedPath];
  if (docsRedirectAlias) {
    return docsRedirectAlias;
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

// BUY-67074: strip a non-canonical `Next-Router-State-Tree` header before it
// reaches the dynamic renderer. See src/lib/router-state-tree.ts for the full
// root-cause writeup.
const ROUTER_STATE_TREE_HEADER = "next-router-state-tree";

// Only the dynamically rendered routes are affected: every other route is
// served from the full-route cache without re-rendering, so a bad tree never
// reaches the renderer there. Keeping this list tight means the early return
// below cannot bypass the redirect/rewrite logic for any other path.
const DYNAMIC_RSC_ROUTES = new Set(["/search", "/compare"]);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // BUY-67074: sanitise a malformed/non-canonical router state tree before it
  // can reach the dynamic renderer and surface as a 500.
  const routerStateTree = request.headers.get(ROUTER_STATE_TREE_HEADER);
  if (
    routerStateTree &&
    DYNAMIC_RSC_ROUTES.has(pathname) &&
    !isCanonicalRouterStateTree(routerStateTree)
  ) {
    const sanitized = new Headers(request.headers);
    sanitized.delete(ROUTER_STATE_TREE_HEADER);
    // Force a full (non-partial) render, which is what a cold navigation does.
    sanitized.delete("next-router-prefetch");
    return NextResponse.next({ request: { headers: sanitized } });
  }

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
  const metadataMiss = optionalMetadataMiss(pathname);
  if (metadataMiss) {
    return metadataMiss;
  }

  // BUY-71735: For /api/v1/* and /api/dashboard/* routes, enforce auth at the middleware
// layer with X-Agent-Auth on 401, so agent probes see the auth signal even before the
// route handler runs. We bypass all other /api/* traffic (revalidate, auth, login, etc.).
const AGENT_AUTH_API_PREFIXES = [
  "/api/dashboard/",
  "/api/v1/developer/",
  "/api/v1/stripe/",
  "/api/auth/me/",
];

if (pathname.startsWith("/api/")) {
  const needsAuth = AGENT_AUTH_API_PREFIXES.some((p) => pathname.startsWith(p));
  if (needsAuth) {
    const apiKey =
      request.cookies.get("bw_dashboard_key")?.value ||
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!apiKey) {
      const res = new NextResponse(
        JSON.stringify({ error: "API key required" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
      return withAgentAuthHeader(request, res);
    }
  }
  return NextResponse.next();
}

if (
  pathname.startsWith("/_next/") ||
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
  // and /compare, strip the Next-Router-State-Tree header so Next.js falls
  // back to a fresh route render (still 200, still the intended content). The
  // route is force-dynamic + has per-route error.tsx + Promise<searchParams>,
  // so a fresh render is safe.
  const rscFlag = request.headers.get("rsc");
  const routerStateHeader = request.headers.get("next-router-state-tree");
  if (
    rscFlag === "1" &&
    routerStateHeader &&
    (pathname === "/search" || pathname === "/compare")
  ) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.delete("next-router-state-tree");
    return NextResponse.next({ request: { headers: requestHeaders } });
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

  // BUY-70666: invalid detail routes (/brands/{slug}, /stores/{slug}, /compare/{...}) must return
  // a hard 404 instead of streaming a soft-200 fallback shell. We resolve the static registry here
  // (same source the page handlers consult) so the missing-entity decision is made BEFORE Next.js
  // begins streaming the App Router HTML — generateMetadata/Page.tsx notFound() in the page body
  // runs too late and the response already commits as 200 with the not-found UI shell.
  if (normalizedForDead.startsWith("/brands/")) {
    const slug = normalizedForDead.slice("/brands/".length).split("/")[0];
    if (slug && !commerceBrands.some((b) => b.slug === slug)) {
      return new NextResponse(null, { status: 404, headers: { "Content-Type": "text/plain" } });
    }
  }
  if (normalizedForDead.startsWith("/stores/")) {
    const slug = normalizedForDead.slice("/stores/".length).split("/")[0];
    if (slug && !commerceStores.some((s) => s.slug === slug)) {
      return new NextResponse(null, { status: 404, headers: { "Content-Type": "text/plain" } });
    }
  }

  // BUY-71642: /products/{numeric-id} soft-404 fix. The route /products/[region]/page.tsx
  // treats numeric ids as "region" and calls getProduct(). When the product is not found,
  // it calls notFound() which returns HTTP 200 (soft-404) - a false-success pattern.
  // This middleware catches numeric-only /products/{id} segments BEFORE Next.js streams
  // the soft-200, and returns a hard 404. The /p/{id} route now serves these products.
  const productsNumericMatch = /^\/products\/(\d{8,})\/?$/.exec(normalizedForDead);
  if (productsNumericMatch) {
    // Let the page handler determine if it's a real product - this is a known Next.js
    // issue where notFound() doesn't set HTTP status correctly. For now, redirect
    // to the canonical /p/{id} alias where the new route handles it properly.
    // TODO: revert to hard 404 once the [region]/page.tsx notFound() is fixed.
    const productId = productsNumericMatch[1];
    const url = request.nextUrl.clone();
    url.pathname = `/p/${productId}`;
    return NextResponse.redirect(url, 308);
  }

  // BUY-71642 gate #3: hard 404 for unknown /p/{id}. The page handler calls
  // notFound() for missing products but Next.js App Router streams the not-found
  // shell as HTTP 200 (soft-404). Middleware runs BEFORE streaming, so we can
  // return a real 404 here. This pre-check bypasses the entire page render.
  const pIdMatch = /^\/p\/(\d{8,})\/?$/.exec(normalizedForDead);
  if (pIdMatch) {
    const productId = pIdMatch[1];
    // Check via internal API - if 404, return hard 404 before page streams.
    try {
      const apiRes = await fetch(
        `${process.env.BUYWHERE_API_INTERNAL_URL || "https://api.buywhere.ai"}/v1/products/${productId}`,
        {
          headers: { Accept: "application/json", Authorization: `Bearer ${process.env.BUYWHERE_API_KEY || ""}` },
          signal: AbortSignal.timeout(3000),
        }
      );
      if (!apiRes.ok) {
        return new NextResponse(null, { status: 404, statusText: "Product Not Found" });
      }
    } catch {
      // Network error - let page render (will show its own error state)
    }
  }

  // BUY-71653: /p/{id} is the canonical short-alias route. Ensure it passes through
  // to the page handler (no middleware redirect/rewrite needed).
  // This is already handled by the static file bypass above.

  // BUY-70653: all single-segment /compare/{slug} routes must resolve to a real
  // static markdown doc or a valid taxonomy category pair. Anything else is a
  // soft-200 fallback shell that crawlers should see as a hard 404. This also
  // prevents the category-pair regex from accidentally 404ing valid compare docs
  // whose filenames contain "-vs-".
  const compareSingleMatch = /^\/compare\/([a-z0-9-]+)\/?$/.exec(normalizedForDead);
  if (compareSingleMatch) {
    const slug = compareSingleMatch[1];
    if (COMPARE_DOC_SLUGS.has(slug) || ACTIVE_COMPARE_STATIC_SLUGS.includes(slug as typeof ACTIVE_COMPARE_STATIC_SLUGS[number])) {
      // valid compare doc or static compare landing page; let the page handler render it
    } else if (/^[a-z0-9-]+-vs-[a-z0-9-]+$/.test(slug)) {
      const [left, right] = slug.split("-vs-");
      const validCategory = PRODUCT_TAXONOMY.some((c) => c.slug === left) &&
                           PRODUCT_TAXONOMY.some((c) => c.slug === right);
      if (!validCategory) {
        return new NextResponse(null, { status: 404, headers: { "Content-Type": "text/plain" } });
      }
    } else {
      return new NextResponse(null, { status: 404, headers: { "Content-Type": "text/plain" } });
    }
  }

  // BUY-69713: indexable compare aliases must not serve 200 generic/not-found shells.
  // Redirect known utility comparison paths to their canonical, structured pages.
  if (normalizedForDead === "/compare/us/electronics") {
    const url = request.nextUrl.clone();
    url.pathname = "/compare/electronics";
    return NextResponse.redirect(url, 301);
  }
  if (normalizedForDead === "/compare/us/amazon/walmart") {
    const url = request.nextUrl.clone();
    url.pathname = "/compare";
    url.search = "country_code=us&q=amazon%20walmart";
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
    return withAgentAuthHeader(request, withBaselineSecurityHeaders(request, response));
  }

  return withAgentAuthHeader(
    request,
    withBaselineSecurityHeaders(request, NextResponse.next())
  );
}

export const config = {
  matcher: ["/:path*"],
};
