/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: false,
  skipTrailingSlashRedirect: true,
  // BUY-57565: re-enabled skipTrailingSlashRedirect.  Without it, Next.js
  // framework re-injects the trailing slash on middleware-issued 301s,
  // causing an infinite /path/ → /path/ → self loop on every trailing-slash
  // URL (regressed after BUY-57663 deploy — middleware now uses fresh
  // new URL() for Location but Next.js overwrites it).  Middleware already
  // handles the 301 to non-slash for valid pages, so this flag lets 410
  // pages pass through unchanged and stops the framework from clobbering
  // middleware-issued redirect Location headers.
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
