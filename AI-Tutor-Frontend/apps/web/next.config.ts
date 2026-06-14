import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  output:
    process.env.VERCEL || process.platform === 'win32'
      ? undefined
      : 'standalone',
  transpilePackages: ['mathml2omml', 'pptxgenjs'],
  serverExternalPackages: ['nodemailer', 'pdfjs-dist', 'tesseract.js', 'canvas'],
  experimental: {
    proxyClientMaxBodySize: '200mb'
  },
  outputFileTracingIncludes: {
    '/api/generate/*': ['./lib/generation/prompts/**/*.md'],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com https://www.google.com https://www.gstatic.com https://*.firebaseapp.com; style-src 'self' 'unsafe-inline' https://accounts.google.com https://fonts.googleapis.com; img-src 'self' data: blob: https://grainy-gradients.vercel.app https://*.r2.cloudflarestorage.com; font-src 'self' data:; connect-src 'self' *; frame-src 'self' https://accounts.google.com https://www.google.com https://www.gstatic.com https://*.firebaseapp.com; media-src 'self' blob: data: https://*.r2.cloudflarestorage.com;",
          },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/api/assets/:path*',
        destination: `${process.env.NEXT_PUBLIC_AI_TUTOR_API_BASE_URL || 'http://localhost:8000'}/api/assets/:path*`,
      },
      {
        source: '/api/classroom-media/:path*',
        destination: `${process.env.NEXT_PUBLIC_AI_TUTOR_API_BASE_URL || 'http://localhost:8000'}/api/classroom-media/:path*`,
      }
    ];
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
        canvas: false,
      };
    }
    return config;
  }
};

export default nextConfig;
