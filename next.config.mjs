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
      // BUY-69692: developer-intent route aliases should redirect to canonical pages
      // or return branded 404/410 with recovery hints instead of thin/empty shells.
      {
        source: '/api-reference/pricing',
        destination: '/pricing',
        permanent: true,
      },
      {
        source: '/developers/pricing',
        destination: '/pricing',
        permanent: true,
      },
      {
        source: '/sdk',
        destination: '/developers',
        permanent: true,
      },
      {
        source: '/ai-agents',
        destination: '/agents',
        permanent: true,
      },
      {
        source: '/llms',
        destination: '/developers',
        permanent: true,
      },
      {
        source: '/docs/pricing',
        destination: '/pricing',
        permanent: true,
      },
      {
        source: '/docs/sdk',
        destination: '/developers',
        permanent: true,
      },
      {
        source: '/docs/mcp',
        destination: '/docs',
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
  async rewrites() {
    return [
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
