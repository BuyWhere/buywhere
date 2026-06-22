/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: false,
  // BUY-55695: removed `skipTrailingSlashRedirect: true`.  The previous
  // combination (middleware rewrite + skipTrailingSlashRedirect) caused
  // slash and non-slash variants to both return HTTP 200, which GSC
  // indexed as duplicate content for 9 URL pairs.  Middleware now 301s
  // trailing-slash URLs to the canonical non-slash form; this flag stays
  // off so Next.js also 308s anything the middleware does not match.
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
