import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';
import bundleAnalyzer from '@next/bundle-analyzer';

// Bundle analyzer: only active for `ANALYZE=true next build` (npm run analyze).
// Writes treemaps to .next/analyze/*.html — zero impact on normal builds.
const withBundleAnalyzer = bundleAnalyzer({ enabled: process.env.ANALYZE === 'true' });

const API_URL = process.env['API_URL'] ?? process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:8081';

// Security headers other than CSP are static and safe to set here. The CSP
// itself is injected per-request from web/src/middleware.ts so that it can
// embed a fresh nonce on every response (see middleware.ts for the full
// directive set + rationale). We deliberately do NOT set a static
// Content-Security-Policy header here — middleware always overrides it,
// but listing it twice causes browsers to honor the strictest of both,
// which would defeat the nonce.
// HSTS is production-only. The previous note ("browsers ignore over HTTP")
// is wrong for some browsers (Safari, in particular) — once an HSTS header
// is observed on ANY response from a host, including http://localhost over
// plain HTTP, Safari caches the policy for the configured max-age and
// force-upgrades every subsequent request to HTTPS. With the dev server
// only listening on plain HTTP, the upgraded request fails with TLS errors
// and the page renders unstyled. Keep HSTS off in development.
const IS_PROD = process.env.NODE_ENV === 'production';

const SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(self), payment=(self)',
  },
  ...(IS_PROD
    ? [
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=63072000; includeSubDomains; preload',
        },
      ]
    : []),
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  eslint: { ignoreDuringBuilds: true },
  typedRoutes: true,
  poweredByHeader: false,
  // PERF-16: tree-shake barrel packages so only used icons/components land
  // in the client graph (lucide alone is imported from ~185 call sites).
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      '@radix-ui/react-avatar',
      '@radix-ui/react-checkbox',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-label',
      '@radix-ui/react-popover',
      '@radix-ui/react-progress',
      '@radix-ui/react-select',
      '@radix-ui/react-separator',
      '@radix-ui/react-slider',
      '@radix-ui/react-slot',
      '@radix-ui/react-switch',
      '@radix-ui/react-tabs',
      '@radix-ui/react-tooltip',
      '@tanstack/react-query',
    ],
  },
  images: {
    // Prefer AVIF over WebP when the browser sends Accept: image/avif.
    // Next.js's image optimizer falls back to WebP, then JPEG/PNG, when
    // AVIF isn't supported. AVIF is ~30% smaller than WebP at the same
    // visual quality — meaningful on listing photo grids.
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '9000',
        pathname: '/nomarkup-dev/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
      },
    ],
  },
  async headers() {
    return [
      {
        // Apply security headers to every response except static asset cache files.
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
      // PERF-15: long-cache fingerprinted Next assets. Content hashes change
      // on every rebuild so immutable is safe. Source maps stay no-store via
      // Sentry/config defaults.
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${API_URL}/api/:path*`,
      },
      {
        source: '/ws/:path*',
        destination: `${API_URL}/ws/:path*`,
      },
    ];
  },
};

// Only run the analyzer wrapper for `npm run analyze`. Calling it on every
// dev/build config-load (even gated enabled:false) was corrupting the dev
// bundler's module graph ("undefined ... reading 'call'"), so keep dev/build
// on the bare config.
const configForExport =
  process.env.ANALYZE === 'true' ? withBundleAnalyzer(nextConfig) : nextConfig;

export default withSentryConfig(configForExport, {
  // Suppresses source map upload logs during build.
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
});
