/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // For Monaco Editor
    config.module.rules.push({
      test: /\.ttf$/,
      type: 'asset/resource',
    });
    return config;
  },
};

module.exports = nextConfig;

