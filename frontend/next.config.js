/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.buywhere.ai',
      },
      {
        protocol: 'https',
        hostname: 'cdn.buywhere.ai',
      },
    ],
  },
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: process.env.API_URL ? `${process.env.API_URL}/v1/:path*` : 'http://localhost:8000/v1/:path*',
      },
    ];
  },
};

module.exports = nextConfig;