import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  /* config options here */
  // React Compiler improves runtime output but can noticeably slow dev compilation on large pages.
  reactCompiler: isProd,
  
  // Production optimizations
  compress: true, // Enable gzip compression
  
  // Optimize images
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60,
  },
  
  // Experimental features for better performance
  experimental: {
    // Enable optimizePackageImports for faster builds
    optimizePackageImports: ['lucide-react', '@tanstack/react-query'],
  },

  // Security headers
  async headers() {
    const scriptSrc = isProd
      ? "script-src 'self' 'unsafe-inline' https://maps.googleapis.com https://maps.gstatic.com"
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://maps.googleapis.com https://maps.gstatic.com";

    const cspBase = [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https: wss:",
      "object-src 'none'",
      // Required for in-app PDF/doc previews rendered from object/blob URLs.
      "frame-src 'self' blob: https://sketchfab.com",
      "base-uri 'self'",
    ];

    const baseHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-XSS-Protection', value: '1; mode=block' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
      ...(isProd
        ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
        : []),
    ];

    // Public embeddable forms: schools embed these in iframes on their own sites.
    // No X-Frame-Options + permissive frame-ancestors so cross-origin framing works.
    const embedHeaders = [
      ...baseHeaders,
      { key: 'Content-Security-Policy', value: [...cspBase, "frame-ancestors *"].join('; ') },
    ];

    // All other routes: deny framing entirely.
    const restrictiveHeaders = [
      ...baseHeaders,
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Content-Security-Policy', value: [...cspBase, "frame-ancestors 'none'"].join('; ') },
    ];

    // IMPORTANT: Next.js headers() uses path-to-regexp which does NOT support
    // negative lookaheads. Using a catch-all with a negative lookahead causes
    // BOTH the embed headers AND restrictive headers to be sent for embed routes,
    // and the browser enforces all CSP policies simultaneously (most restrictive
    // wins — frame-ancestors 'none' blocks the iframe).
    //
    // Fix: explicitly list the authenticated route prefixes that must never be
    // framed, instead of relying on a catch-all exclusion.
    const authenticatedPrefixes = [
      '/admin',
      '/teacher',
      '/student',
      '/driver',
      '/super-admin',
      '/login',
      '/register',
    ]

    return [
      // Public embeddable forms — no X-Frame-Options, frame-ancestors allows all.
      { source: '/teacher-appointment/:path*', headers: embedHeaders },
      { source: '/admission/:path*',           headers: embedHeaders },
      // Authenticated routes — deny framing entirely.
      ...authenticatedPrefixes.map(prefix => ({
        source: `${prefix}/:path*`,
        headers: restrictiveHeaders,
      })),
      // Also cover exact matches (e.g. /login with no trailing path)
      ...authenticatedPrefixes.map(prefix => ({
        source: prefix,
        headers: restrictiveHeaders,
      })),
    ];
  },
};

export default nextConfig;

