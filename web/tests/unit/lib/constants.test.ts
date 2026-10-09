// Tests for `resolveWsBase` — the single place every WebSocket client (chat,
// auction, spectator, marketplace spectator) derives its host from. Getting
// this wrong sends sockets straight at the backend port instead of through the
// Next rewrite proxy, which is what caused the token-in-URL logging and the
// "closed due to suspension" reconnect storms during HMR.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function importConstants() {
  return import('@/lib/constants');
}

/** Swap jsdom's location wholesale — individual props are not redefinable. */
function stubLocation(protocol: string, host: string): () => void {
  const original = window.location;
  const stub = {
    protocol,
    host,
    hostname: original.hostname,
    href: original.href,
    origin: original.origin,
    pathname: original.pathname,
    port: original.port,
    search: original.search,
    hash: original.hash,
    toString: () => original.toString(),
  };
  Object.defineProperty(window, 'location', { configurable: true, value: stub });
  return () => {
    Object.defineProperty(window, 'location', { configurable: true, value: original });
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('resolveWsBase', () => {
  it('prefers an explicit NEXT_PUBLIC_WS_URL over the browser origin', async () => {
    vi.stubEnv('NEXT_PUBLIC_WS_URL', 'wss://ws.no-markup.com');
    const { resolveWsBase } = await importConstants();
    expect(resolveWsBase()).toBe('wss://ws.no-markup.com');
  });

  it('trims surrounding whitespace off the explicit URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_WS_URL', '  wss://ws.no-markup.com  ');
    const { resolveWsBase } = await importConstants();
    expect(resolveWsBase()).toBe('wss://ws.no-markup.com');
  });

  it('ignores a whitespace-only NEXT_PUBLIC_WS_URL and falls back to the origin', async () => {
    vi.stubEnv('NEXT_PUBLIC_WS_URL', '   ');
    const restore = stubLocation('http:', 'localhost:3000');
    try {
      const { resolveWsBase } = await importConstants();
      expect(resolveWsBase()).toBe('ws://localhost:3000');
    } finally {
      restore();
    }
  });

  it('uses ws:// + the current origin when no explicit URL is set', async () => {
    vi.stubEnv('NEXT_PUBLIC_WS_URL', '');
    const restore = stubLocation('http:', 'localhost:3000');
    try {
      const { resolveWsBase } = await importConstants();
      // Same-origin so the Next dev-server rewrite proxies /ws/* — no CORS,
      // no direct-to-8081 dial.
      expect(resolveWsBase()).toBe('ws://localhost:3000');
    } finally {
      restore();
    }
  });

  it('upgrades to wss:// when the page itself is served over https', async () => {
    vi.stubEnv('NEXT_PUBLIC_WS_URL', '');
    const restore = stubLocation('https:', 'app.no-markup.com');
    try {
      const { resolveWsBase } = await importConstants();
      expect(resolveWsBase()).toBe('wss://app.no-markup.com');
    } finally {
      restore();
    }
  });

  it('falls back to API_BASE_URL with the scheme rewritten when there is no window (SSR)', async () => {
    vi.stubEnv('NEXT_PUBLIC_WS_URL', '');
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.no-markup.com');
    vi.stubGlobal('window', undefined);
    const { resolveWsBase } = await importConstants();
    expect(resolveWsBase()).toBe('wss://api.no-markup.com');
  });

  it('rewrites a plain-http API_BASE_URL to ws:// in the SSR fallback', async () => {
    vi.stubEnv('NEXT_PUBLIC_WS_URL', '');
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:8080');
    vi.stubGlobal('window', undefined);
    const { resolveWsBase } = await importConstants();
    expect(resolveWsBase()).toBe('ws://localhost:8080');
  });

  it('returns an empty string when there is neither a window nor an API base', async () => {
    vi.stubEnv('NEXT_PUBLIC_WS_URL', '');
    vi.stubEnv('NEXT_PUBLIC_API_URL', '');
    vi.stubGlobal('window', undefined);
    const { resolveWsBase } = await importConstants();
    expect(resolveWsBase()).toBe('');
  });
});

describe('API_BASE_URL', () => {
  it('defaults to an empty string so client HTTP calls stay same-origin', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', '');
    const { API_BASE_URL } = await importConstants();
    expect(API_BASE_URL).toBe('');
  });

  it('uses NEXT_PUBLIC_API_URL when one is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.no-markup.com');
    const { API_BASE_URL } = await importConstants();
    expect(API_BASE_URL).toBe('https://api.no-markup.com');
  });
});
