import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  output:
    process.env.VERCEL || process.platform === 'win32'
      ? undefined
      : 'standalone',
  transpilePackages: ['mathml2omml', 'pptxgenjs'],
  serverExternalPackages: ['nodemailer', 'pdfjs-dist', 'tesseract.js'],
  experimental: {
    proxyClientMaxBodySize: '200mb'
  },
  webpack: (config, { isServer, webpack }) => {
    if (!isServer) {
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource: any) => {
          resource.request = resource.request.replace(/^node:/, '');
        })
      );
      config.resolve.alias = {
        ...config.resolve.alias,
      };
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        https: false,
        http: false,
        crypto: false,
        os: false,
        path: false,
        stream: false,
        net: false,
        tls: false,
        child_process: false,
      };
    }
    return config;
  }
};

export default nextConfig;
