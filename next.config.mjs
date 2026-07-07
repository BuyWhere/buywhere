/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: false,
  skipTrailingSlashRedirect: true,
  // BUY-57565: re-enabled skipTrailingSlashRedirect.  Without it, trailing-slash
  // URLs on 410 pages (blog posts, docs pages) redirect to wrong targets instead
  // of also returning 410.  Middleware already handles 301 → non-slash for
  // valid pages, so this flag lets 410 pages pass through unchanged.
  output: 'standalone',
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'picsum.photos' },
      { protocol: 'https', hostname: 'm.media-amazon.com' },
      { protocol: 'https', hostname: 'images-na.ssl-images-amazon.com' },
      { protocol: 'https', hostname: 'cf.shopee.sg' },
      { protocol: 'https', hostname: 's.shopee.sg' },
      { protocol: 'https', hostname: '**.shopee.sg' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
    ],
  },
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
