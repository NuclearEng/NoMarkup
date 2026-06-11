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

function runMiddleware(): string {
  // The HTML-rendering branch of the middleware sets the CSP header. We hit
  // a non-API, non-protected path so we exercise that branch without auth.
  const req = new NextRequest('http://localhost:3000/');
  const res = middleware(req);
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

  it("does NOT include 'unsafe-eval' in script-src when NODE_ENV=production", () => {
    vi.stubEnv('NODE_ENV', 'production');
    const csp = runMiddleware();
    const scriptSrc = extractDirective(csp, 'script-src');
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it("DOES include 'unsafe-eval' in script-src when NODE_ENV=development", () => {
    vi.stubEnv('NODE_ENV', 'development');
    const csp = runMiddleware();
    const scriptSrc = extractDirective(csp, 'script-src');
    expect(scriptSrc).toContain("'unsafe-eval'");
  });
});

describe('middleware auth gate — AUTH_ONLY_API', () => {
  it.each(['/api/analyze-job-image', '/api/analyze-listing-image'])(
    'returns 401 JSON for %s without any session indicator',
    async (path) => {
      const req = new NextRequest(`http://localhost:3000${path}`, { method: 'POST' });
      const res = middleware(req);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'unauthorized' });
    },
  );

  it.each(['/api/analyze-job-image', '/api/analyze-listing-image'])(
    'lets %s through to the route handler when a Bearer token is present',
    (path) => {
      const req = new NextRequest(`http://localhost:3000${path}`, {
        method: 'POST',
        headers: { authorization: 'Bearer some-token' },
      });
      const res = middleware(req);
      // NextResponse.next() — the route handler performs the real JWT
      // verification; the middleware only screens for presence.
      expect(res.status).toBe(200);
    },
  );
});
