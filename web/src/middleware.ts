import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge auth guard for authenticated routes.
 *
 * The gateway is the authoritative authenticator — this middleware only
 * checks for the presence of session indicators so unauthenticated clients
 * (bots, direct fetches, SSR probes) are redirected before pages render.
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

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  const isProtectedPage = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  );
  const isProtectedApi = AUTH_ONLY_API.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  );

  if (!isProtectedPage && !isProtectedApi) {
    return NextResponse.next();
  }

  if (hasSessionIndicator(req)) {
    return NextResponse.next();
  }

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

export const config = {
  // Skip Next.js internals and static assets; everything else flows through.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon|public/).*)'],
};
