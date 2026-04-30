/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: true,
  output: 'standalone',
  distDir: '.next-deploy',
};

export default nextConfig;
