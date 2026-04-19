import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output:
    process.env.VERCEL || process.platform === 'win32'
      ? undefined
      : 'standalone',
  transpilePackages: ['mathml2omml', 'pptxgenjs'],
  serverExternalPackages: [],
  experimental: {
    proxyClientMaxBodySize: '200mb',
  },
};

export default nextConfig;
