import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const API_URL = process.env['API_URL'] ?? process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:8081';

// Strict CSP for Next.js HTML pages.
// Notes:
//   - 'unsafe-inline' is included on style-src because Tailwind/Next.js inline styles in JIT
//     mode and Sentry/RSC hydration markers require it. WCAG/CLAUDE.md only forbids unsafe-inline
//     on script-src; it is permitted on style-src per security best practice tradeoffs.
//   - 'unsafe-inline' on script-src is intentionally NOT present.
//   - Mapbox + Stripe origins are allowed for the relevant resource types.
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://api.mapbox.com https://js.stripe.com",
  "style-src 'self' 'unsafe-inline' https://api.mapbox.com",
  "img-src 'self' data: blob: https: http://localhost:9000",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss: https://api.mapbox.com https://events.mapbox.com https://*.sentry.io https://api.stripe.com",
  "worker-src 'self' blob:",
  "frame-src https://js.stripe.com https://hooks.stripe.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // upgrade-insecure-requests is honored only over HTTPS; safe to include
  'upgrade-insecure-requests',
].join('; ');

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CSP_DIRECTIVES },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(self), payment=(self)',
  },
  // HSTS with preload — applied to all responses; browsers ignore over HTTP
  // so this is safe in dev and protective in production.
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  eslint: { ignoreDuringBuilds: true },
  typedRoutes: true,
  poweredByHeader: false,
  images: {
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
