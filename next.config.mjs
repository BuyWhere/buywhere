/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: false,
  // Prevent Next.js from issuing 308 redirects on trailing-slash URLs.
  // Instead, the middleware (src/middleware.ts) rewrites them to the
  // non-trailing-slash path, serving a 200 directly.  This eliminates
  // the redirect chain that caused Google to report "Page with redirect"
  // and occasionally drop slugs (BUY-40084).
  skipTrailingSlashRedirect: true,
  output: 'standalone',
  distDir: '.next-deploy',
  async redirects() {
    return [
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
};

export default nextConfig;
