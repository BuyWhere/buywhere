/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: false,
  skipTrailingSlashRedirect: true,
  // BUY-57565: re-enabled skipTrailingSlashRedirect.  Without it, trailing-slash
  // URLs on 410 pages (blog posts, docs pages) redirect to wrong targets instead
  // of also returning 410.  Middleware already handles 301 → non-slash for
  // valid pages, so this flag lets 410 pages pass through unchanged.
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
