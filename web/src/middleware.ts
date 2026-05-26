import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge auth guard for authenticated routes + per-request CSP nonce.
 *
 * Two responsibilities:
 *
 * 1. AUTH GUARD — The gateway is the authoritative authenticator; this
 *    middleware only checks for the presence of session indicators so
 *    unauthenticated clients (bots, direct fetches, SSR probes) are redirected
 *    before pages render.
 *
 * 2. CSP NONCE — A cryptographically-random nonce is generated per request
 *    and embedded in the Content-Security-Policy header so we can drop
 *    'unsafe-inline' from script-src. Next.js 15 RSC reads the nonce from the
 *    `x-nonce` request header (set here) and automatically attaches it to its
 *    bootstrapping inline scripts. Page components can also read it via
 *    `headers().get('x-nonce')` and pass it to <Script> tags.
 *
 *    The nonce is also paired with 'strict-dynamic', which trusts scripts
 *    transitively loaded by an explicitly-trusted (nonce'd) script. This lets
 *    Next.js bootstrap chunks load without enumerating every chunk URL.
 *
 * Cookies in play:
 *   - has_session=1          — sentinel set by the gateway when a refresh
 *                              token cookie is issued (non-HttpOnly sentinel
 *                              for client-side detection)
 *   - refresh_token          — HttpOnly, path-scoped to /api/v1/auth; not
 *                              always readable here but worth checking when
 *                              the browser sends it
 *   - oauth_access_token     — short-lived OAuth callback cookie
 *
 * The access JWT itself lives in memory on the client and is sent as a
 * Bearer token on API requests, so we also accept an Authorization header.
 */

// Routes that render inside (dashboard) — i.e. the authenticated layout.
// These map to the top-level URL segments under web/src/app/(dashboard)/.
const PROTECTED_PREFIXES: readonly string[] = [
  '/admin',
  '/analytics',
  '/bids',
  '/contracts',
  '/dashboard',
  '/disputes',
  '/insurance',
  '/jobs/mine',
  '/jobs/new',
  '/jobs/recurring',
  '/messages',
  '/notifications',
  '/payments',
  '/profile',
  '/properties',
  '/provider',
  '/settings',
];

// API routes that must be called by an authenticated user. `/jobs` (public
// browse), `/jobs/[id]` (public detail), and `/providers` (public search) are
// deliberately excluded.
const AUTH_ONLY_API: readonly string[] = ['/api/analyze-job-image'];

function hasSessionIndicator(req: NextRequest): boolean {
  const cookies = req.cookies;
  if (cookies.get('has_session')?.value === '1') return true;
  if (cookies.get('refresh_token')?.value) return true;
  if (cookies.get('oauth_access_token')?.value) return true;

  const auth = req.headers.get('authorization');
  if (auth && /^Bearer\s+\S+/i.test(auth)) return true;

  return false;
}

/**
 * Generate a 128-bit random nonce, base64-encoded. Edge runtime supports
 * the Web Crypto API; we avoid Node's `Buffer` so this works in both.
 */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) {
    // bounds-checked above; assertion is safe here
    bin += String.fromCharCode(bytes[i] as number);
  }
  return btoa(bin);
}

/**
 * Build the per-request CSP. The nonce gates script-src; everything else
 * matches the previously-static policy in next.config.ts. With
 * 'strict-dynamic' present, allowlist hosts on script-src are ignored by
 * CSP3-aware browsers — but legacy browsers still honor them, so we keep
 * api.mapbox.com and js.stripe.com listed for graceful fallback.
 */
function buildCsp(nonce: string): string {
  // The web app talks to the gateway as a separate origin (NEXT_PUBLIC_API_URL).
  // In production that's a same-domain proxy or a public api.* host; in dev
  // it's typically http://localhost:8081 + ws://localhost:8081. We allow the
  // configured origin (and its WS counterpart) when set.
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? '';
  const wsUrl = process.env['NEXT_PUBLIC_WS_URL'] ?? '';
  const apiOrigins: string[] = [];
  for (const u of [apiUrl, wsUrl]) {
    if (!u) continue;
    try {
      const parsed = new URL(u);
      apiOrigins.push(parsed.origin);
      // ws:// or wss:// counterpart for the same host
      if (parsed.protocol === 'http:') {
        apiOrigins.push(`ws://${parsed.host}`);
      } else if (parsed.protocol === 'https:') {
        apiOrigins.push(`wss://${parsed.host}`);
      }
    } catch {
      // ignore malformed
    }
  }
  const extra = apiOrigins.join(' ');
  // upgrade-insecure-requests is production-only. In dev it force-upgrades
  // http://localhost calls to https://localhost, which the dev server can't
  // serve and causes a "TLS error" / "network connection lost" cascade in
  // Safari. Keep it for prod where every backend is HTTPS.
  const isProd = process.env.NODE_ENV === 'production';
  // Next.js dev (HMR/React Refresh) and Mapbox GL JS use eval()/new Function().
  // Add 'unsafe-eval' ONLY in non-production builds — prod CSP stays locked down.
  const scriptSrcEval = isProd ? '' : " 'unsafe-eval'";
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${scriptSrcEval} https://api.mapbox.com https://js.stripe.com`,
    "style-src 'self' 'unsafe-inline' https://api.mapbox.com",
    "img-src 'self' data: blob: https: http://localhost:9000",
    "font-src 'self' data:",
    `connect-src 'self' ${extra} ws: wss: https://api.mapbox.com https://events.mapbox.com https://*.sentry.io https://api.stripe.com`,
    "worker-src 'self' blob:",
    "frame-src https://js.stripe.com https://hooks.stripe.com",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
  if (isProd) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  // ─── Auth gate ──────────────────────────────────────────────────────────
  const isProtectedPage = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  );
  const isProtectedApi = AUTH_ONLY_API.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  );

  if ((isProtectedPage || isProtectedApi) && !hasSessionIndicator(req)) {
    if (isProtectedApi) {
      return new NextResponse(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // ─── CSP nonce injection ────────────────────────────────────────────────
  // Skip CSP work for asset-y paths the matcher already excludes most of, but
  // also avoid generating a nonce for raw API rewrites since they don't
  // render HTML.
  const isApiPath = pathname.startsWith('/api/') || pathname.startsWith('/ws/');

  if (isApiPath) {
    return NextResponse.next();
  }

  const nonce = generateNonce();
  const csp = buildCsp(nonce);

  // Forward the nonce to RSC/page components via a request header.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  // Some Next.js docs samples use this name; setting both is harmless and
  // covers patterns that copy from those examples.
  requestHeaders.set('content-security-policy', csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set('Content-Security-Policy', csp);

  return response;
}

export const config = {
  // Skip Next.js internals and static assets; everything else flows through.
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|icon|public/).*)',
      missing: [
        // Don't bother running middleware on prefetch requests — they don't
        // render HTML and would otherwise consume CSRNG budget unnecessarily.
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
