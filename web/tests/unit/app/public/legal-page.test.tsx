// `/legal` Server Component (page.tsx). Asserts the fail-closed feature-flag
// gate (notFound() unless the backend explicitly reports legal_services=true),
// the category-tree walk that resolves the `legal` subtree root, the exact jobs
// URL fetched with/without that id, and the empty-catalog fallbacks.
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Job, JobsResponse } from '@/types';

const serverFetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
vi.mock('@/lib/server-fetch', () => ({
  serverFetch: (url: string, init?: RequestInit) => serverFetch(url, init),
}));

const notFound = vi.fn<() => never>();
vi.mock('next/navigation', () => ({
  notFound: () => notFound(),
}));

interface IslandProps {
  initialJobs: JobsResponse;
  legalCategoryId: string | null;
}

const islandProps: IslandProps[] = [];
vi.mock('@/app/(public)/legal/LegalLandingClient', () => ({
  LegalLandingClient: (props: IslandProps) => {
    islandProps.push(props);
    return createElement('div', { 'data-testid': 'legal-island' });
  },
}));

const EMPTY_PAGINATION: JobsResponse['pagination'] = {
  totalCount: 0,
  page: 1,
  pageSize: 12,
  totalPages: 0,
  hasNext: false,
};

const ORIGIN = 'http://gateway.internal:8081';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Responder = () => Promise<Response>;

interface Upstream {
  flags: Responder;
  tree: Responder;
  jobs: Responder;
}

const LEGAL_TREE = {
  categories: [
    { id: 'cat-home', slug: 'home-services', children: [{ id: 'cat-plumb', slug: 'plumbing' }] },
    { id: 'cat-legal', slug: 'legal', children: [{ id: 'cat-wills', slug: 'wills' }] },
  ],
};

function defaultUpstream(): Upstream {
  return {
    flags: () => Promise.resolve(jsonResponse({ legal_services: true })),
    tree: () => Promise.resolve(jsonResponse(LEGAL_TREE)),
    jobs: () => Promise.resolve(jsonResponse({ jobs: [], pagination: EMPTY_PAGINATION })),
  };
}

/** Route serverFetch by pathname so each upstream can be failed independently. */
function mockUpstream(overrides: Partial<Upstream> = {}): void {
  const upstream = { ...defaultUpstream(), ...overrides };
  serverFetch.mockImplementation((url) => {
    const { pathname } = new URL(url);
    if (pathname === '/api/v1/flags') return upstream.flags();
    if (pathname === '/api/v1/categories/tree') return upstream.tree();
    if (pathname === '/api/v1/jobs') return upstream.jobs();
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
}

function callFor(pathname: string): [string, RequestInit | undefined] {
  const call = serverFetch.mock.calls.find(([url]) => new URL(url).pathname === pathname);
  if (!call) throw new Error(`no fetch for ${pathname}`);
  return [call[0], call[1]];
}

function fetchedPaths(): string[] {
  return serverFetch.mock.calls.map(([url]) => new URL(url).pathname);
}

async function loadPage() {
  vi.resetModules();
  return import('@/app/(public)/legal/page');
}

async function renderPage(): Promise<IslandProps> {
  const { default: LegalLandingPage } = await loadPage();
  render(await LegalLandingPage());
  expect(screen.getByTestId('legal-island')).toBeInTheDocument();
  const props = islandProps.at(-1);
  if (!props) throw new Error('LegalLandingClient was not rendered');
  return props;
}

beforeEach(() => {
  islandProps.length = 0;
  serverFetch.mockReset();
  mockUpstream();
  notFound.mockReset();
  notFound.mockImplementation(() => {
    throw new Error('NEXT_NOT_FOUND');
  });
  vi.stubEnv('API_URL', ORIGIN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/legal page — feature-flag gate (fail closed)', () => {
  it.each<[string, Responder]>([
    ['the flag is explicitly false', () => Promise.resolve(jsonResponse({ legal_services: false }))],
    ['the flag key is missing', () => Promise.resolve(jsonResponse({ smart_matching: true }))],
    ['the flags endpoint is not OK', () => Promise.resolve(jsonResponse({ error: 'down' }, 503))],
    ['the flags fetch throws', () => Promise.reject(new Error('ECONNREFUSED'))],
    [
      'the flags body is not JSON',
      () => Promise.resolve(new Response('<html>oops</html>', { status: 200 })),
    ],
  ])('calls notFound() and fetches nothing else when %s', async (_label, flags) => {
    mockUpstream({ flags });
    const { default: LegalLandingPage } = await loadPage();
    await expect(LegalLandingPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledTimes(1);
    expect(islandProps).toHaveLength(0);
    expect(fetchedPaths()).toEqual(['/api/v1/flags']);
  });

  it('reads the flags with a 60s revalidate window', async () => {
    await renderPage();
    expect(callFor('/api/v1/flags')).toEqual([`${ORIGIN}/api/v1/flags`, { next: { revalidate: 60 } }]);
    expect(notFound).not.toHaveBeenCalled();
  });
});

describe('/legal page — upstream origin', () => {
  it('falls back to NEXT_PUBLIC_API_URL when API_URL is unset', async () => {
    vi.stubEnv('API_URL', undefined);
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://public.example.com');
    await renderPage();
    expect(serverFetch.mock.calls.map(([url]) => new URL(url).origin)).toEqual([
      'https://public.example.com',
      'https://public.example.com',
      'https://public.example.com',
    ]);
  });

  it('falls back to localhost when neither origin is set', async () => {
    vi.stubEnv('API_URL', undefined);
    vi.stubEnv('NEXT_PUBLIC_API_URL', undefined);
    await renderPage();
    expect(callFor('/api/v1/flags')[0]).toBe('http://localhost:8081/api/v1/flags');
  });
});

describe('/legal page — resolving the legal category', () => {
  it('finds a top-level legal node and filters the jobs fetch by its id', async () => {
    const { legalCategoryId } = await renderPage();
    expect(legalCategoryId).toBe('cat-legal');
    expect(callFor('/api/v1/categories/tree')).toEqual([
      `${ORIGIN}/api/v1/categories/tree`,
      { next: { revalidate: 300 } },
    ]);
    expect(callFor('/api/v1/jobs')).toEqual([
      `${ORIGIN}/api/v1/jobs?page=1&page_size=12&category_ids=cat-legal`,
      { next: { revalidate: 30 } },
    ]);
  });

  it('finds a legal node nested under another root', async () => {
    mockUpstream({
      tree: () =>
        Promise.resolve(
          jsonResponse({
            categories: [
              { id: 'cat-a', slug: 'a', children: null },
              {
                id: 'cat-services',
                slug: 'services',
                children: [
                  { id: 'cat-b', slug: 'b', children: [] },
                  { id: 'cat-deep-legal', slug: 'legal' },
                ],
              },
            ],
          }),
        ),
    });
    const { legalCategoryId } = await renderPage();
    expect(legalCategoryId).toBe('cat-deep-legal');
  });

  it.each<[string, Responder]>([
    [
      'no node has the legal slug',
      () => Promise.resolve(jsonResponse({ categories: [{ id: 'cat-a', slug: 'a' }] })),
    ],
    ['categories is null', () => Promise.resolve(jsonResponse({ categories: null }))],
    ['the body has no categories field', () => Promise.resolve(jsonResponse({}))],
    ['the tree endpoint is not OK', () => Promise.resolve(jsonResponse({ error: 'x' }, 500))],
    ['the tree fetch throws', () => Promise.reject(new Error('ETIMEDOUT'))],
  ])('still renders with a null id and an unfiltered jobs fetch when %s', async (_label, tree) => {
    mockUpstream({ tree });
    const { legalCategoryId } = await renderPage();
    expect(legalCategoryId).toBeNull();
    expect(callFor('/api/v1/jobs')[0]).toBe(`${ORIGIN}/api/v1/jobs?page=1&page_size=12`);
  });
});

describe('/legal page — seeding the client island', () => {
  const job = { id: 'job-1', title: 'Draft an operating agreement' } as Job;
  const pagination: JobsResponse['pagination'] = {
    totalCount: 1,
    page: 1,
    pageSize: 12,
    totalPages: 1,
    hasNext: false,
  };

  it('seeds the fetched jobs and pagination', async () => {
    mockUpstream({ jobs: () => Promise.resolve(jsonResponse({ jobs: [job], pagination })) });
    const { initialJobs } = await renderPage();
    expect(initialJobs).toEqual({ jobs: [job], pagination });
  });

  it.each<[string, Responder]>([
    ['null jobs / pagination', () => Promise.resolve(jsonResponse({ jobs: null, pagination: null }))],
    ['missing fields', () => Promise.resolve(jsonResponse({}))],
    ['a non-OK response', () => Promise.resolve(jsonResponse({ error: 'down' }, 502))],
    ['a thrown fetch', () => Promise.reject(new Error('ECONNRESET'))],
  ])('seeds an empty first page on %s', async (_label, jobs) => {
    mockUpstream({ jobs });
    const { initialJobs, legalCategoryId } = await renderPage();
    expect(initialJobs).toEqual({ jobs: [], pagination: EMPTY_PAGINATION });
    expect(legalCategoryId).toBe('cat-legal');
  });
});

describe('/legal page — metadata', () => {
  it('exports legal-specific titles with the fee promise in both descriptions', async () => {
    const { metadata } = await loadPage();
    const { BUYER_PAYS_AGREED_PRICE } = await import('@/lib/constants');
    expect(metadata.title).toBe('Legal Services · NoMarkup');
    expect(metadata.openGraph?.title).toBe('Lawyers compete for your case · NoMarkup');
    expect(metadata.description).toContain(BUYER_PAYS_AGREED_PRICE);
    expect(metadata.openGraph?.description).toContain(BUYER_PAYS_AGREED_PRICE);
  });
});
