/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: false,
  skipTrailingSlashRedirect: true,
  // BUY-57565: re-enabled skipTrailingSlashRedirect.  Without it, trailing-slash
  // URLs on 410 pages (blog posts, docs pages) redirect to wrong targets instead
  // of also returning 410.  Middleware already handles 301 → non-slash for
  // valid pages, so this flag lets 410 pages pass through unchanged.
  output: 'standalone',
  distDir: '\.next-deploy',
  // BUY-59983: /\\_next/image was returning HTTP 400 for every product image
  // because no remotePatterns were configured, so Next.js rejected every
  // upstream host the catalog uses.  The list below is the union of hosts
  // observed in /api/products/search results plus the QA-fixture domains
  // (picsum.photos, images.unsplash.com).  Add new merchants here when they
  // first appear in the catalog rather than disabling optimization globally.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'picsum.photos' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'cdn.shopify.com' },
      { protocol: 'https', hostname: 'm.media-amazon.com' },
      { protocol: 'https', hostname: 'hnsgsfp.imgix.net' },
      { protocol: 'https', hostname: 'media.nedigital.sg' },
      { protocol: 'https', hostname: 'sg-live.slatic.net' },
      { protocol: 'https', hostname: 'static1.fortytwo.sg' },
      { protocol: 'https', hostname: 'giant.sg' },
      { protocol: 'https', hostname: 'down-sg.img.susercontent.com' },
      { protocol: 'https', hostname: 'www.courts.com.sg' },
      { protocol: 'https', hostname: 'www.gaincity.com' },
      { protocol: 'https', hostname: 'cdn.bestdenki.com.sg' },
    ],
  },
  async redirects() {
    return [
      // BUY-68319/BUY-67102: keep root-domain MCP clients on the
      // canonical API-host MCP endpoint instead of the human docs page.
      {
        source: '/mcp',
        destination: 'https://api.buywhere.ai/mcp',
        permanent: true,
      },
      {
        source: '/mcp/:path*',
        destination: 'https://api.buywhere.ai/mcp/:path*',
        permanent: true,
      },
      // BUY-68368: high-intent developer/API aliases should not fall through
      // to homepage-branded 404 HTML shells. Route them to canonical docs/API
      // resources before the App Router renders the generic not-found page.
      {
        source: '/developer',
        destination: '/developers',
        permanent: true,
      },
      {
        source: '/api-docs',
        destination: '/docs',
        permanent: true,
      },
      {
        source: '/developers/docs',
        destination: '/docs',
        permanent: true,
      },
      {
        source: '/developers/api',
        destination: '/docs/api-reference/search',
        permanent: true,
      },
      {
        source: '/swagger.json',
        destination: 'https://api.buywhere.ai/openapi.json',
        permanent: true,
      },
      // BUY-68406: common feed-discovery aliases at the site root previously
      // fell through to the homepage HTML 404 shell. Redirect them to the
      // canonical blog feed (which serves real RSS 2.0 XML) so feed readers
      // and crawlers get a machine-readable response on any of these paths.
      {
        source: '/rss.xml',
        destination: '/blog/rss.xml',
        permanent: true,
      },
      {
        source: '/feed.xml',
        destination: '/blog/rss.xml',
        permanent: true,
      },
      {
        source: '/atom.xml',
        destination: '/blog/rss.xml',
        permanent: true,
      },
      // BUY-68536: plausible developer/account aliases should recover to the
      // canonical private dashboard or API-key acquisition page instead of the
      // generic shopping 404 shell.
      {
        source: '/developer-dashboard',
        destination: '/dashboard',
        permanent: true,
      },
      {
        source: '/developers/dashboard',
        destination: '/dashboard',
        permanent: true,
      },
      {
        source: '/account/api-keys',
        destination: '/api-keys',
        permanent: true,
      },
      {
        source: '/developers/api-keys',
        destination: '/api-keys',
        permanent: true,
      },
      // BUY-68551: common account payment, invoice, and subscription aliases
      // should recover to the noindex private account shell with a route-aware
      // tab hint instead of serving the generic homepage-branded 404 shell.
      {
        source: '/billing/portal',
        destination: '/account?tab=billing',
        permanent: true,
      },
      {
        source: '/portal-session',
        destination: '/account?tab=billing',
        permanent: true,
      },
      {
        source: '/portal-session/create',
        destination: '/account?tab=billing',
        permanent: true,
      },
      {
        source: '/checkout/session',
        destination: '/account?tab=billing',
        permanent: true,
      },
      {
        source: '/billing/portal-session',
        destination: '/account?tab=billing',
        permanent: true,
      },
      {
        source: '/saved-payment',
        destination: '/account?tab=payment-methods',
        permanent: true,
      },
      {
        source: '/saved-payments',
        destination: '/account?tab=payment-methods',
        permanent: true,
      },
      {
        source: '/payment-methods',
        destination: '/account?tab=payment-methods',
        permanent: true,
      },
      {
        source: '/account/payment-methods',
        destination: '/account?tab=payment-methods',
        permanent: true,
      },
      {
        source: '/invoices',
        destination: '/account?tab=invoices',
        permanent: true,
      },
      {
        source: '/billing/invoices',
        destination: '/account?tab=invoices',
        permanent: true,
      },
      {
        source: '/account/invoices',
        destination: '/account?tab=invoices',
        permanent: true,
      },
      {
        source: '/subscription-management',
        destination: '/account?tab=subscription',
        permanent: true,
      },
      {
        source: '/manage-subscription',
        destination: '/account?tab=subscription',
        permanent: true,
      },
      {
        source: '/account/subscription',
        destination: '/account?tab=subscription',
        permanent: true,
      },
      // BUY-68422: surface existing status page infrastructure at apex domain
      {
        source: '/status',
        destination: 'https://status.buywhere.ai/',
        permanent: true,
      },
      // BUY-68422: redirect help/support routes to docs
      {
        source: '/help',
        destination: '/docs',
        permanent: true,
      },
      {
        source: '/support',
        destination: '/docs',
        permanent: true,
      },
      {
        source: '/help-center',
        destination: '/docs',
        permanent: true,
      },
      {
        source: '/knowledge-base',
        destination: '/docs',
        permanent: true,
      },
      {
        source: '/kb',
        destination: '/docs',
        permanent: true,
      },
      // BUY-67767: /affiliates is the legacy affiliate-program URL. Redirect
      // at the routing layer so direct HTML requests get a real 308 before
      // the App Router page stub runs.
      {
        source: '/affiliates',
        destination: '/partnership',
        permanent: true,
      },
      // BUY-71825: AEO regression fixes - restore agent and compare/sg surfaces.
      // /agent was returning 404 noindex shell; redirect to canonical /agents page.
      {
        source: '/agent',
        destination: '/agents',
        permanent: true,
      },
      // BUY-71825: /agent.json was returning 404 noindex shell; redirect to canonical
      // agent metadata at /.well-known/agent.json (served by src/app/.well-known/agent.json/route.ts).
      {
        source: '/agent.json',
        destination: '/.well-known/agent.json',
        permanent: true,
      },
      // BUY-71825: /compare/sg was returning 200 but with noindex + no H1 (not indexable).
      // "sg" is a country code, not a category slug - redirect to /compare landing.
      {
        source: '/compare/sg',
        destination: '/compare',
        permanent: true,
      },
      {
        source: '/:path*',
        has: [
          {
            type: 'host',
            value: 'www.buywhere.ai',
          },
        ],
        destination: 'https://buywhere.ai/:path*',
        permanent: true,
      },
    ];
  },
  async headers() {
    // BUY-71735: P2.3 agent-discovery HTTP headers.
    // - X-Agent-Protocol + X-Agent-Card + X-LLMs-Txt on every response.
    // - X-Agent-Index only on 200 catalog responses (catalog route matchers).
    // - Access-Control-Expose-Headers lists all five so browser agents
    //   (LangChain in-browser, etc.) can read them.
    //
    // NOTE: re-applied on top of BUY-71746 (Hex, 2026-08-19 11:06 UTC) which
    // incidentally dropped the original headers() block from this file during
    // its sitemap-index rewrite. Live probes confirmed all 5 headers absent
    // from https://buywhere.ai/ responses after that push, so this restoration
    // closes the regression.
    const ALL_AGENT_HEADERS = {
      "X-Agent-Protocol": "buywhere/v1",
      "X-Agent-Card": "https://api.buywhere.ai/.well-known/agent.json",
      "X-LLMs-Txt": "https://api.buywhere.ai/llms.txt",
      "Access-Control-Expose-Headers":
        "X-Agent-Protocol, X-Agent-Card, X-LLMs-Txt, X-Agent-Index, X-Agent-Auth",
    };

    const HEADERS_FOR_ALL = Object.entries(ALL_AGENT_HEADERS).map(
      ([key, value]) => ({ key, value }),
    );

    // Base headers applied to every route under the matcher below.
    const baseHeaders = [
      // Apply to every route EXCEPT Next.js static/_next assets.
      {
        source: "/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap.*\\.xml).*)",
        headers: HEADERS_FOR_ALL,
      },
    ];

    // Catalog-only: add X-Agent-Index. The 200-only gate is enforced upstream by
    // Vercel/edge; if a non-200 slips through (rare), the value still points at
    // the canonical search endpoint, which is non-leaky.
    const X_AGENT_INDEX = "https://api.buywhere.ai/v1/products/search?q={q}&country_code={cc}";
    const catalogHeaders = [
      {
        source: "/search",
        headers: [...HEADERS_FOR_ALL, { key: "X-Agent-Index", value: X_AGENT_INDEX }],
      },
      {
        source: "/search/:path*",
        headers: [...HEADERS_FOR_ALL, { key: "X-Agent-Index", value: X_AGENT_INDEX }],
      },
      {
        source: "/products",
        headers: [...HEADERS_FOR_ALL, { key: "X-Agent-Index", value: X_AGENT_INDEX }],
      },
      {
        source: "/products/:path*",
        headers: [...HEADERS_FOR_ALL, { key: "X-Agent-Index", value: X_AGENT_INDEX }],
      },
      {
        source: "/p",
        headers: [...HEADERS_FOR_ALL, { key: "X-Agent-Index", value: X_AGENT_INDEX }],
      },
      {
        source: "/p/:path*",
        headers: [...HEADERS_FOR_ALL, { key: "X-Agent-Index", value: X_AGENT_INDEX }],
      },
      {
        source: "/compare",
        headers: [...HEADERS_FOR_ALL, { key: "X-Agent-Index", value: X_AGENT_INDEX }],
      },
      {
        source: "/compare/:path*",
        headers: [...HEADERS_FOR_ALL, { key: "X-Agent-Index", value: X_AGENT_INDEX }],
      },
    ];

    return [...baseHeaders, ...catalogHeaders];
  },
  async rewrites() {
    return [
      // F19 (2026-08-20): affiliate click hops served from the ROOT domain so every
      // real human click counts as buywhere.ai traffic (measurement + attribution).
      {
        source: '/r/:path*',
        destination: 'https://api.buywhere.ai/r/:path*',
      },
      {
        source: '/api/click',
        destination: 'https://api.buywhere.ai/api/click',
      },
      // /api/v1/* → api.buywhere.ai/v1/*  (canonical v1 path)
      {
        source: '/api/v1/:path*',
        destination: 'https://api.buywhere.ai/v1/:path*',
      },
      // /api/* → api.buywhere.ai/v1/*  (legacy v0-style root-domain API calls)
      {
        source: '/api/:path*',
        destination: 'https://api.buywhere.ai/v1/:path*',
      },
      // /mcp, /mcp/* → mcp.buywhere.ai/mcp/*
      {
        source: '/mcp/:path*',
        destination: 'https://mcp.buywhere.ai/mcp/:path*',
      },
      {
        source: '/mcp',
        destination: 'https://mcp.buywhere.ai/mcp',
      },
    ];
  },
};

export default nextConfig;
