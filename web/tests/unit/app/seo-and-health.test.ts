// sitemap.ts, robots.ts and the /api/health route — the crawl surface and the
// k8s probe. The sitemap must still render its static routes when the gateway
// is down (build time), and robots must keep authenticated sections out.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

async function loadSitemap() {
  vi.resetModules();
  return (await import('@/app/sitemap')).default;
}

async function loadRobots() {
  vi.resetModules();
  return (await import('@/app/robots')).default;
}

const STATIC_PATHS = ['/', '/marketplace', '/jobs', '/providers', '/pricing', '/legal'];

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://no-markup.test');
  vi.stubEnv('API_INTERNAL_URL', 'http://gateway.internal:8081');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('sitemap', () => {
  it('lists static routes plus one URL per public listing, job and provider', async () => {
    fetchMock.mockImplementation((url) => {
      if (url.includes('/listings')) return Promise.resolve(json({ listings: [{ id: 'l1' }, { id: 'l2' }] }));
      if (url.includes('/jobs')) return Promise.resolve(json({ jobs: [{ id: 'j1' }] }));
      return Promise.resolve(json({ providers: [{ id: 'p1' }] }));
    });
    const sitemap = await loadSitemap();

    const entries = await sitemap();

    expect(entries.map((e) => e.url)).toEqual([
      ...STATIC_PATHS.map((p) => `https://no-markup.test${p}`),
      'https://no-markup.test/marketplace/l1',
      'https://no-markup.test/marketplace/l2',
      'https://no-markup.test/jobs/j1',
      'https://no-markup.test/providers/p1',
    ]);
    expect(entries[0]).toMatchObject({ changeFrequency: 'daily', priority: 1 });
    expect(entries.find((e) => e.url.endsWith('/marketplace/l1'))).toMatchObject({
      changeFrequency: 'hourly',
      priority: 0.7,
    });
    expect(entries.find((e) => e.url.endsWith('/providers/p1'))).toMatchObject({
      changeFrequency: 'weekly',
      priority: 0.6,
    });
  });

  it('enumerates entities from the internal gateway origin with an hourly revalidate and a timeout', async () => {
    fetchMock.mockResolvedValue(json({}));
    const sitemap = await loadSitemap();

    await sitemap();

    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      'http://gateway.internal:8081/api/v1/listings?page_size=1000',
      'http://gateway.internal:8081/api/v1/jobs?page_size=1000',
      'http://gateway.internal:8081/api/v1/providers/search?page_size=1000',
    ]);
    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit & { next?: { revalidate?: number } };
      expect(init.next).toEqual({ revalidate: 3600 });
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it.each([
    ['API_INTERNAL_URL unset → NEXT_PUBLIC_API_URL', 'https://api.public.test', 'https://api.public.test'],
    ['neither set → localhost', undefined, 'http://localhost:8081'],
  ])('%s', async (_label, publicUrl, expectedOrigin) => {
    vi.stubEnv('API_INTERNAL_URL', undefined);
    vi.stubEnv('NEXT_PUBLIC_API_URL', publicUrl);
    fetchMock.mockResolvedValue(json({}));
    const sitemap = await loadSitemap();

    await sitemap();

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${expectedOrigin}/api/v1/listings?page_size=1000`);
  });

  it('falls back to the production site URL when NEXT_PUBLIC_SITE_URL is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', undefined);
    fetchMock.mockResolvedValue(json({}));
    const sitemap = await loadSitemap();

    const entries = await sitemap();

    expect(entries[0]?.url).toBe('https://no-markup.com/');
  });

  it('still renders the static routes when the gateway is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const sitemap = await loadSitemap();

    const entries = await sitemap();

    expect(entries.map((e) => e.url)).toEqual(
      STATIC_PATHS.map((p) => `https://no-markup.test${p}`),
    );
  });

  it('treats a non-OK response, a missing key and a non-JSON body as "no entities" per feed', async () => {
    fetchMock.mockImplementation((url) => {
      if (url.includes('/listings')) return Promise.resolve(json({ error: 'down' }, 503));
      if (url.includes('/jobs')) return Promise.resolve(json({ unexpected: [] }));
      return Promise.resolve(new Response('<html>', { status: 200 }));
    });
    const sitemap = await loadSitemap();

    const entries = await sitemap();

    expect(entries).toHaveLength(STATIC_PATHS.length);
  });

  it('skips rows without an id, and one failing feed does not drop the others', async () => {
    fetchMock.mockImplementation((url) => {
      if (url.includes('/listings')) return Promise.reject(new Error('timeout'));
      if (url.includes('/jobs')) {
        return Promise.resolve(json({ jobs: [{ id: 'j1' }, {}, { id: '' }, { id: 'j2' }] }));
      }
      return Promise.resolve(json({ providers: [] }));
    });
    const sitemap = await loadSitemap();

    const entries = await sitemap();

    expect(entries.slice(STATIC_PATHS.length).map((e) => e.url)).toEqual([
      'https://no-markup.test/jobs/j1',
      'https://no-markup.test/jobs/j2',
    ]);
  });
});

describe('robots', () => {
  it('allows the public site but disallows the API and every authenticated section', async () => {
    const robots = await loadRobots();

    const result = robots();

    expect(result.sitemap).toBe('https://no-markup.test/sitemap.xml');
    expect(result.host).toBe('https://no-markup.test');
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
    expect(rules).toHaveLength(1);
    expect(rules[0]?.userAgent).toBe('*');
    expect(rules[0]?.allow).toBe('/');
    expect(rules[0]?.disallow).toEqual(
      expect.arrayContaining([
        '/api/',
        '/dashboard',
        '/admin',
        '/provider',
        '/settings',
        '/messages',
        '/payments',
        '/orders',
        '/contracts',
        '/bids',
        '/me/',
        '/profile',
      ]),
    );
    // Public catalog surfaces must stay crawlable.
    for (const publicPath of ['/marketplace', '/jobs', '/providers', '/pricing']) {
      expect(rules[0]?.disallow).not.toContain(publicPath);
    }
  });

  it('falls back to the production host when NEXT_PUBLIC_SITE_URL is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', undefined);
    const robots = await loadRobots();

    expect(robots().sitemap).toBe('https://no-markup.com/sitemap.xml');
  });
});

describe('/api/health', () => {
  it('GET reports ok without touching any dependency and is never cached', async () => {
    const route = await import('@/app/api/health/route');

    const res = route.GET();

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ status: 'ok', service: 'web' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('HEAD answers 200 with no body and no-store', async () => {
    const route = await import('@/app/api/health/route');

    const res = route.HEAD();

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.text()).toBe('');
  });

  it('opts out of static rendering so a dead process cannot serve a cached 200', async () => {
    const route = await import('@/app/api/health/route');

    expect(route.dynamic).toBe('force-dynamic');
    expect(route.revalidate).toBe(0);
  });
});
