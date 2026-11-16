// middleware — session indicators other than the signed flag (refresh
// cookie, OAuth cookie, bearer header), a signed flag with no secret
// configured, prefix matching, the login redirect target, API paths, and how
// configured API / WS URLs appear in connect-src.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { middleware } from '@/middleware';
import { SESSION_FLAG_COOKIE, signSessionFlag } from '@/lib/session-flag';

const ORIGIN = 'http://localhost:3000';

function request(path: string, init: { cookie?: string; authorization?: string } = {}): NextRequest {
  const headers = new Headers();
  if (init.cookie) headers.set('cookie', init.cookie);
  if (init.authorization) headers.set('authorization', init.authorization);
  return new NextRequest(`${ORIGIN}${path}`, { headers });
}

function isPassThrough(res: Response): boolean {
  return res.headers.get('x-middleware-next') === '1';
}

function connectSources(res: Response): string[] {
  const csp = res.headers.get('Content-Security-Policy') ?? '';
  const directive = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('connect-src '));
  if (!directive) throw new Error(`no connect-src in: ${csp}`);
  return directive.split(/\s+/).slice(1);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('protected pages — session indicators', () => {
  it('redirects to /login with the original path when there is no indicator', async () => {
    const res = await middleware(request('/dashboard/provider?tab=bids'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/login?next=%2Fdashboard%2Fprovider`);
  });

  it.each([
    ['a refresh_token cookie', { cookie: 'refresh_token=abc' }],
    ['an oauth_access_token cookie', { cookie: 'oauth_access_token=abc' }],
    ['a bearer Authorization header', { authorization: 'Bearer abc.def.ghi' }],
    ['a lower-case bearer scheme', { authorization: 'bearer abc' }],
  ])('lets the request through with %s', async (_name, init) => {
    const res = await middleware(request('/settings', init));

    expect(res.status).toBe(200);
    expect(isPassThrough(res)).toBe(true);
    expect(res.headers.get('location')).toBeNull();
  });

  it.each([
    ['an empty refresh_token cookie', { cookie: 'refresh_token=' }],
    ['a Basic Authorization header', { authorization: 'Basic dXNlcjpwdw==' }],
    ['"Bearer" with no token', { authorization: 'Bearer ' }],
  ])('still redirects with %s', async (_name, init) => {
    const res = await middleware(request('/settings', init));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/login?next=%2Fsettings`);
  });

  it('does not trust a correctly signed flag when no secret is configured on this server', async () => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    const flag = await signSessionFlag('some-secret', 'user-1', exp);
    vi.stubEnv('HAS_SESSION_SECRET', '');
    vi.stubEnv('SESSION_SECRET', '');

    const res = await middleware(request('/orders', { cookie: `${SESSION_FLAG_COOKIE}=${flag}` }));

    expect(res.status).toBe(307);
  });

  it('falls back to the refresh cookie when the signed flag is invalid', async () => {
    vi.stubEnv('SESSION_SECRET', 'some-secret');

    const res = await middleware(
      request('/orders', { cookie: `${SESSION_FLAG_COOKIE}=v1.user-1.1.forged; refresh_token=abc` }),
    );

    expect(isPassThrough(res)).toBe(true);
  });
});

describe('route matching', () => {
  it.each(['/me', '/me/wishlist', '/jobs/new', '/provider/advances'])('%s is protected', async (path) => {
    const res = await middleware(request(path));
    expect(res.status).toBe(307);
  });

  it.each(['/', '/jobs', '/jobs/abc-123', '/meow', '/providers/p-1', '/marketplace'])(
    '%s is public (prefixes match whole path segments only)',
    async (path) => {
      const res = await middleware(request(path));
      expect(res.status).toBe(200);
      expect(isPassThrough(res)).toBe(true);
    },
  );

  it('answers a protected API route with 401 JSON, not a redirect', async () => {
    const res = await middleware(request('/api/analyze-listing-image/batch'));

    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toBe('application/json');
    await expect(res.json()).resolves.toEqual({ error: 'unauthorized' });
  });

  it.each(['/api/health', '/ws/auction/job-1'])('%s passes through without a CSP or nonce', async (path) => {
    const res = await middleware(request(path));

    expect(isPassThrough(res)).toBe(true);
    expect(res.headers.get('Content-Security-Policy')).toBeNull();
    expect(res.headers.get('x-middleware-request-x-nonce')).toBeNull();
  });

  it('lets an authenticated protected API call through without a CSP', async () => {
    const res = await middleware(
      request('/api/analyze-job-image', { authorization: 'Bearer abc' }),
    );

    expect(isPassThrough(res)).toBe(true);
    expect(res.headers.get('Content-Security-Policy')).toBeNull();
  });
});

describe('CSP', () => {
  it('forwards the same nonce to the app that the script-src carries, fresh per request', async () => {
    const first = await middleware(request('/'));
    const second = await middleware(request('/'));
    const nonce = first.headers.get('x-middleware-request-x-nonce');

    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(first.headers.get('Content-Security-Policy')).toContain(`'nonce-${nonce ?? ''}'`);
    expect(first.headers.get('x-middleware-request-content-security-policy')).toBe(
      first.headers.get('Content-Security-Policy'),
    );
    expect(second.headers.get('x-middleware-request-x-nonce')).not.toBe(nonce);
  });

  it('allows the http API origin plus its ws:// twin', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:8080/api');
    vi.stubEnv('NEXT_PUBLIC_WS_URL', '');

    const sources = connectSources(await middleware(request('/')));

    expect(sources).toContain('http://localhost:8080');
    expect(sources).toContain('ws://localhost:8080');
    expect(sources).not.toContain('wss://localhost:8080');
  });

  it('allows the https API origin plus its wss:// twin, and a wss WS URL as-is', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.no-markup.test');
    vi.stubEnv('NEXT_PUBLIC_WS_URL', 'wss://ws.no-markup.test/socket');

    const sources = connectSources(await middleware(request('/')));

    expect(sources).toContain('https://api.no-markup.test');
    expect(sources).toContain('wss://api.no-markup.test');
    expect(sources).toContain('wss://ws.no-markup.test');
    expect(sources).not.toContain('ws://api.no-markup.test');
  });

  it('ignores an unparseable configured URL instead of failing the request', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'not a url');
    vi.stubEnv('NEXT_PUBLIC_WS_URL', '');

    const sources = connectSources(await middleware(request('/')));

    expect(sources).toEqual([
      "'self'",
      'https://api.mapbox.com',
      'https://events.mapbox.com',
      'https://*.sentry.io',
      'https://api.stripe.com',
    ]);
  });
});
