// `/pricing/[slug]` Server Component (page.tsx). Asserts the encoded upstream
// URL, notFound() on a failed fetch vs. the empty-state for a valid but empty
// category, the ZIP table rows, and generateMetadata's name fallbacks.
import { render, screen, within } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PricingData } from '@/hooks/usePricing';

const serverFetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
vi.mock('@/lib/server-fetch', () => ({
  serverFetch: (url: string, init?: RequestInit) => serverFetch(url, init),
}));

const notFound = vi.fn<() => never>();
vi.mock('next/navigation', () => ({
  notFound: () => notFound(),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

const heatMapSlugs: string[] = [];
vi.mock('@/components/maps/PriceHeatMap', () => ({
  PriceHeatMap: ({ categorySlug }: { categorySlug: string }) => {
    heatMapSlugs.push(categorySlug);
    return createElement('div', { 'data-testid': 'price-heatmap' });
  },
}));

function makeRow(overrides: Partial<PricingData> = {}): PricingData {
  return {
    category_name: 'House Cleaning',
    category_slug: 'house-cleaning',
    zip_code: '98107',
    completed_jobs: 14,
    avg_price_cents: 19000,
    p25_price_cents: 15000,
    median_price_cents: 18550,
    p75_price_cents: 22000,
    min_price_cents: 9000,
    max_price_cents: 40000,
    avg_savings_cents: null,
    refreshed_at: '2026-11-01T00:00:00Z',
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function loadPage() {
  vi.resetModules();
  return import('@/app/(public)/pricing/[slug]/page');
}

function params(slug: string): { params: Promise<{ slug: string }> } {
  return { params: Promise.resolve({ slug }) };
}

async function renderPage(slug: string): Promise<void> {
  const { default: PricingCategoryPage } = await loadPage();
  render(await PricingCategoryPage(params(slug)));
}

async function metadataFor(slug: string) {
  const { generateMetadata } = await loadPage();
  return generateMetadata(params(slug));
}

beforeEach(() => {
  heatMapSlugs.length = 0;
  serverFetch.mockReset();
  serverFetch.mockResolvedValue(jsonResponse({ prices: [makeRow()] }));
  notFound.mockReset();
  notFound.mockImplementation(() => {
    throw new Error('NEXT_NOT_FOUND');
  });
  vi.stubEnv('API_URL', 'http://gateway.internal:8081');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://site.example.com');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/pricing/[slug] page — upstream fetch', () => {
  it('fetches the category prices with a 300s revalidate', async () => {
    await renderPage('house-cleaning');
    expect(serverFetch).toHaveBeenCalledTimes(1);
    expect(serverFetch).toHaveBeenCalledWith(
      'http://gateway.internal:8081/api/v1/pricing/house-cleaning',
      { next: { revalidate: 300 } },
    );
  });

  it('URI-encodes a slug so it cannot escape the pricing path', async () => {
    await renderPage('../admin?x=1');
    expect(serverFetch.mock.calls[0]?.[0]).toBe(
      'http://gateway.internal:8081/api/v1/pricing/..%2Fadmin%3Fx%3D1',
    );
  });

  it('falls back to NEXT_PUBLIC_API_URL, then localhost', async () => {
    vi.stubEnv('API_URL', undefined);
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://public.example.com');
    await renderPage('roofing');
    expect(serverFetch.mock.calls[0]?.[0]).toBe('https://public.example.com/api/v1/pricing/roofing');

    // A Response body is single-use — hand the second render a fresh one.
    serverFetch.mockResolvedValue(jsonResponse({ prices: [makeRow()] }));
    vi.stubEnv('NEXT_PUBLIC_API_URL', undefined);
    await renderPage('roofing');
    expect(serverFetch.mock.calls[1]?.[0]).toBe('http://localhost:8081/api/v1/pricing/roofing');
  });
});

describe('/pricing/[slug] page — rendering', () => {
  it('renders one table row per ZIP with the formatted median and job count', async () => {
    serverFetch.mockResolvedValue(
      jsonResponse({
        prices: [
          makeRow(),
          makeRow({ zip_code: '98115', median_price_cents: 21000, completed_jobs: 3 }),
        ],
      }),
    );
    await renderPage('house-cleaning');

    expect(
      screen.getByRole('heading', { level: 1, name: 'House Cleaning prices by ZIP' }),
    ).toBeInTheDocument();
    const table = screen.getByRole('table', {
      name: 'Median completed-job prices for House Cleaning by ZIP',
    });
    const rows = within(table).getAllByRole('row');
    // Header + two ZIP rows.
    expect(rows).toHaveLength(3);
    const first = rows[1];
    const second = rows[2];
    if (!first || !second) throw new Error('expected two body rows');
    expect(within(first).getAllByRole('cell').map((c) => c.textContent)).toEqual([
      '98107',
      '$185.50',
      '14',
    ]);
    expect(within(second).getAllByRole('cell').map((c) => c.textContent)).toEqual([
      '98115',
      '$210.00',
      '3',
    ]);
    expect(screen.queryByText('No completed-job pricing for this category yet.')).toBeNull();
  });

  it('hands the route slug to the heat map and links back to the index and to post a job', async () => {
    await renderPage('house-cleaning');
    expect(heatMapSlugs).toEqual(['house-cleaning']);
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(breadcrumb).getByRole('link', { name: 'Fair Price Index' })).toHaveAttribute(
      'href',
      '/pricing',
    );
    expect(within(breadcrumb).getByText('House Cleaning')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Post a job' })).toHaveAttribute('href', '/jobs/new');
  });

  it.each<[string, unknown]>([
    ['an empty prices list', { prices: [] }],
    ['prices: null', { prices: null }],
    ['a body with no prices field', {}],
  ])('shows the empty state — not a 404 — for %s, naming the category from the slug', async (_l, body) => {
    serverFetch.mockResolvedValue(jsonResponse(body));
    await renderPage('gutter-deep-clean');
    expect(notFound).not.toHaveBeenCalled();
    expect(
      screen.getByRole('heading', { level: 1, name: 'gutter deep clean prices by ZIP' }),
    ).toBeInTheDocument();
    expect(screen.getByText('No completed-job pricing for this category yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByTestId('price-heatmap')).toBeInTheDocument();
  });

  it.each<[string, () => void]>([
    [
      'a 404',
      () => {
        serverFetch.mockResolvedValue(jsonResponse({ error: 'unknown category' }, 404));
      },
    ],
    [
      'a 500',
      () => {
        serverFetch.mockResolvedValue(jsonResponse({ error: 'boom' }, 500));
      },
    ],
    [
      'a network error',
      () => {
        serverFetch.mockRejectedValue(new Error('ECONNREFUSED'));
      },
    ],
    [
      'a non-JSON body',
      () => {
        serverFetch.mockResolvedValue(new Response('<html></html>', { status: 200 }));
      },
    ],
  ])('calls notFound() on %s', async (_label, arrange) => {
    arrange();
    const { default: PricingCategoryPage } = await loadPage();
    await expect(PricingCategoryPage(params('nope'))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledTimes(1);
    expect(heatMapSlugs).toHaveLength(0);
  });
});

describe('/pricing/[slug] page — generateMetadata', () => {
  it('names the category from the first price row', async () => {
    expect(await metadataFor('house-cleaning')).toEqual({
      title: 'House Cleaning prices by ZIP — Fair Price Index | NoMarkup',
      description:
        'Completed-job median prices for House Cleaning by ZIP code. Post a job and let providers compete.',
      alternates: { canonical: '/pricing/house-cleaning' },
      openGraph: {
        title: 'House Cleaning prices by ZIP — Fair Price Index | NoMarkup',
        description:
          'Completed-job median prices for House Cleaning by ZIP code. Post a job and let providers compete.',
        type: 'website',
        url: 'https://site.example.com/pricing/house-cleaning',
      },
    });
  });

  it('de-hyphenates the slug when the category has no rows', async () => {
    serverFetch.mockResolvedValue(jsonResponse({ prices: [] }));
    const metadata = await metadataFor('gutter-deep-clean');
    expect(metadata.title).toBe('gutter deep clean prices by ZIP — Fair Price Index | NoMarkup');
  });

  it('de-hyphenates the slug when the fetch fails, and keeps the canonical on the raw slug', async () => {
    serverFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    const metadata = await metadataFor('tree-removal');
    expect(metadata.title).toBe('tree removal prices by ZIP — Fair Price Index | NoMarkup');
    expect(metadata.alternates).toEqual({ canonical: '/pricing/tree-removal' });
  });

  it('builds the Open Graph URL on the production origin when NEXT_PUBLIC_SITE_URL is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', undefined);
    const metadata = await metadataFor('house-cleaning');
    expect(metadata.openGraph?.url).toBe('https://no-markup.com/pricing/house-cleaning');
  });
});
