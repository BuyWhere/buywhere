/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: false,
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
