import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { middleware } from '@/middleware';

/**
 * Regression pin for the CSP `script-src` directive.
 *
 * Production CSP must NOT contain `'unsafe-eval'` — it's only permitted in
 * non-production builds because Next.js dev (HMR/React Refresh) and Mapbox GL
 * JS rely on eval()/new Function(). If a future refactor accidentally lets
 * `'unsafe-eval'` leak into prod, this test fails loudly.
 *
 * See `web/src/middleware.ts` — `buildCsp(nonce)`.
 */

function extractDirective(csp: string, name: string): string {
  const found = csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `) || d === name);
  if (!found) throw new Error(`directive "${name}" not found in CSP: ${csp}`);
  return found;
}

async function runMiddleware(): Promise<string> {
  // The HTML-rendering branch of the middleware sets the CSP header. We hit
  // a non-API, non-protected path so we exercise that branch without auth.
  const req = new NextRequest('http://localhost:3000/');
  const res = await middleware(req);
  const csp = res.headers.get('Content-Security-Policy');
  if (!csp) throw new Error('Content-Security-Policy header was not set');
  return csp;
}

describe('middleware CSP — script-src unsafe-eval policy', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does NOT include 'unsafe-eval' in script-src when NODE_ENV=production", async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const csp = await runMiddleware();
    const scriptSrc = extractDirective(csp, 'script-src');
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it("DOES include 'unsafe-eval' in script-src when NODE_ENV=development", async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const csp = await runMiddleware();
    const scriptSrc = extractDirective(csp, 'script-src');
    expect(scriptSrc).toContain("'unsafe-eval'");
  });
});

describe('middleware CSP — connect-src (SEC-12)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does NOT allow bare ws: / wss: wildcards', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.com');
    vi.stubEnv('NEXT_PUBLIC_WS_URL', 'wss://api.example.com');
    const req = new NextRequest('http://localhost:3000/');
    const res = await middleware(req);
    const csp = res.headers.get('Content-Security-Policy');
    if (!csp) throw new Error('CSP missing');
    const connectSrc = extractDirective(csp, 'connect-src');
    // Bare scheme wildcards must not appear; explicit origins only.
    expect(connectSrc.split(/\s+/)).not.toContain('ws:');
    expect(connectSrc.split(/\s+/)).not.toContain('wss:');
    expect(connectSrc).toContain("'self'");
    expect(connectSrc).toContain('https://api.example.com');
    expect(connectSrc).toContain('wss://api.example.com');
  });
});

describe('middleware auth gate — AUTH_ONLY_API', () => {
  it.each(['/api/analyze-job-image', '/api/analyze-listing-image'])(
    'returns 401 JSON for %s without any session indicator',
    async (path) => {
      const req = new NextRequest(`http://localhost:3000${path}`, { method: 'POST' });
      const res = await middleware(req);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'unauthorized' });
    },
  );

  it.each(['/api/analyze-job-image', '/api/analyze-listing-image'])(
    'lets %s through to the route handler when a Bearer token is present',
    async (path) => {
      const req = new NextRequest(`http://localhost:3000${path}`, {
        method: 'POST',
        headers: { authorization: 'Bearer some-token' },
      });
      const res = await middleware(req);
      // NextResponse.next() — the route handler performs the real JWT
      // verification; the middleware only screens for presence.
      expect(res.status).toBe(200);
    },
  );
});

describe('middleware auth gate — SEC-07 signed has_session', () => {
  const SECRET = 'middleware-sec07-test-secret';

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function signedFlag(userId = 'user-1', expOffsetSec = 3600): Promise<string> {
    const { signSessionFlag } = await import('@/lib/session-flag');
    const exp = Math.floor(Date.now() / 1000) + expOffsetSec;
    return signSessionFlag(SECRET, userId, exp);
  }

  it('redirects protected pages when has_session is the forgeable literal "1"', async () => {
    vi.stubEnv('SESSION_SECRET', SECRET);
    const req = new NextRequest('http://localhost:3000/dashboard', {
      headers: { cookie: 'has_session=1' },
    });
    const res = await middleware(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });

  it('allows protected pages when has_session is a valid HMAC-signed value', async () => {
    vi.stubEnv('SESSION_SECRET', SECRET);
    const flag = await signedFlag();
    const req = new NextRequest('http://localhost:3000/dashboard', {
      headers: { cookie: `has_session=${flag}` },
    });
    const res = await middleware(req);
    // Soft gate passes → CSP path (HTML) returns next() with 200.
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Security-Policy')).toBeTruthy();
  });

  it('rejects an expired signed has_session', async () => {
    vi.stubEnv('SESSION_SECRET', SECRET);
    const flag = await signedFlag('user-1', -120);
    const req = new NextRequest('http://localhost:3000/dashboard', {
      headers: { cookie: `has_session=${flag}` },
    });
    const res = await middleware(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });

  it('rejects a forged MAC on has_session', async () => {
    vi.stubEnv('SESSION_SECRET', SECRET);
    const flag = await signedFlag();
    const parts = flag.split('.');
    parts[3] = 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ';
    const req = new NextRequest('http://localhost:3000/dashboard', {
      headers: { cookie: `has_session=${parts.join('.')}` },
    });
    const res = await middleware(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });

  it('uses HAS_SESSION_SECRET when set (dedicated key)', async () => {
    vi.stubEnv('HAS_SESSION_SECRET', SECRET);
    vi.stubEnv('SESSION_SECRET', 'wrong-secret-must-not-be-used');
    const flag = await signedFlag();
    const req = new NextRequest('http://localhost:3000/settings', {
      headers: { cookie: `has_session=${flag}` },
    });
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });
});

