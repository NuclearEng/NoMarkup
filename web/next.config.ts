import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

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
    ],
  },
  async headers() {
    return [
      {
        // Apply security headers to every response except static asset cache files.
        source: '/:path*',
        headers: SECURITY_HEADERS,
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

export default withSentryConfig(nextConfig, {
  // Suppresses source map upload logs during build.
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
});
