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
    // BUY-59983: allow /_next/image proxy to fetch upstream catalog image hosts.
    // Without this allowlist every <Image> with an external src returns HTTP 400.
    remotePatterns: [
      // Placeholder/fallback images rendered by comparison + US product components
      { protocol: 'https', hostname: 'picsum.photos' },
      // Amazon product catalog images
      { protocol: 'https', hostname: 'm.media-amazon.com' },
      { protocol: 'https', hostname: 'images-na.ssl-images-amazon.com' },
      // Shopee catalog images (Singapore + cross-region CDN)
      { protocol: 'https', hostname: 'cf.shopee.sg' },
      { protocol: 'https', hostname: 's.shopee.sg' },
      { protocol: 'https', hostname: '**.shopee.sg' },
      // Unsplash stock imagery (used by some landing/hero assets)
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
