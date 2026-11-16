// `/` Server Component (page.tsx) — the async RSC entry, as opposed to the
// LandingPageClient island covered by landing.test.tsx. Asserts the pricing
// URL fetched and the seeding contract: ticker rows on success, an EMPTY list
// for a healthy-but-empty API, and NO prop at all (client refetches) on error.
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TickerItem } from '@/components/landing/ticker-items';
import type { PricingOverviewCategory } from '@/hooks/usePricing';

const serverFetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
vi.mock('@/lib/server-fetch', () => ({
  serverFetch: (url: string, init?: RequestInit) => serverFetch(url, init),
}));

interface IslandProps {
  initialTickerItems?: TickerItem[];
}

const islandProps: IslandProps[] = [];
vi.mock('@/app/(public)/LandingPageClient', () => ({
  LandingPageClient: (props: IslandProps) => {
    islandProps.push(props);
    return createElement('div', { 'data-testid': 'landing-island' });
  },
}));

const CATEGORIES: PricingOverviewCategory[] = [
  {
    category_name: 'Plumbing',
    category_slug: 'plumbing',
    total_jobs: 42,
    avg_median_cents: 18000,
    avg_savings_cents: 3000,
  },
  {
    category_name: 'Roofing',
    category_slug: 'roofing',
    total_jobs: 7,
    avg_median_cents: 950000,
    avg_savings_cents: null,
  },
  {
    // No completed jobs — must be filtered out of the ticker.
    category_name: 'Masonry',
    category_slug: 'masonry',
    total_jobs: 0,
    avg_median_cents: 0,
    avg_savings_cents: null,
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function loadPage() {
  vi.resetModules();
  return import('@/app/(public)/page');
}

async function renderPage(): Promise<IslandProps> {
  const { default: LandingPage } = await loadPage();
  render(await LandingPage());
  expect(screen.getByTestId('landing-island')).toBeInTheDocument();
  const props = islandProps.at(-1);
  if (!props) throw new Error('LandingPageClient was not rendered');
  return props;
}

beforeEach(() => {
  islandProps.length = 0;
  serverFetch.mockReset();
  serverFetch.mockResolvedValue(jsonResponse({ categories: CATEGORIES }));
  vi.stubEnv('API_URL', 'http://gateway.internal:8081');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/ page — upstream fetch', () => {
  it('fetches the pricing overview from the server-only API_URL with a 60s revalidate', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://public.example.com');
    await renderPage();
    expect(serverFetch).toHaveBeenCalledTimes(1);
    expect(serverFetch).toHaveBeenCalledWith('http://gateway.internal:8081/api/v1/pricing', {
      next: { revalidate: 60 },
    });
  });

  it('falls back to NEXT_PUBLIC_API_URL when API_URL is unset', async () => {
    vi.stubEnv('API_URL', undefined);
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://public.example.com');
    await renderPage();
    expect(serverFetch.mock.calls[0]?.[0]).toBe('https://public.example.com/api/v1/pricing');
  });

  it('falls back to localhost when neither origin is set', async () => {
    vi.stubEnv('API_URL', undefined);
    vi.stubEnv('NEXT_PUBLIC_API_URL', undefined);
    await renderPage();
    expect(serverFetch.mock.calls[0]?.[0]).toBe('http://localhost:8081/api/v1/pricing');
  });
});

describe('/ page — seeding the ticker', () => {
  it('maps priced categories to ticker rows and drops categories with no jobs', async () => {
    const { initialTickerItems } = await renderPage();
    expect(initialTickerItems).toEqual([
      {
        category: 'Plumbing',
        location: '42 jobs',
        currentPrice: 18000,
        originalPrice: 21000,
        status: 'completed',
      },
      { category: 'Roofing', location: '7 jobs', currentPrice: 950000, status: 'active' },
    ]);
  });

  it.each<[string, unknown]>([
    ['an empty categories list', { categories: [] }],
    ['categories: null', { categories: null }],
    ['a body with no categories field', {}],
  ])('seeds an empty list (API up, nothing to show) for %s', async (_label, body) => {
    serverFetch.mockResolvedValue(jsonResponse(body));
    const props = await renderPage();
    expect(props).toEqual({ initialTickerItems: [] });
  });

  it.each<[string, () => void]>([
    [
      'a non-OK response',
      () => {
        serverFetch.mockResolvedValue(jsonResponse({ error: 'down' }, 503));
      },
    ],
    [
      'a thrown fetch',
      () => {
        serverFetch.mockRejectedValue(new Error('ECONNREFUSED'));
      },
    ],
    [
      'a non-JSON body',
      () => {
        serverFetch.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 200 }));
      },
    ],
  ])('passes no initialTickerItems prop at all on %s so the client fetches itself', async (_l, arrange) => {
    arrange();
    const props = await renderPage();
    expect(props).not.toHaveProperty('initialTickerItems');
  });
});

describe('/ page — metadata', () => {
  it('exports the landing titles with the fee promise in both descriptions', async () => {
    const { metadata } = await loadPage();
    const { BUYER_PAYS_AGREED_PRICE } = await import('@/lib/constants');
    expect(metadata.title).toBe('NoMarkup — The Market Sets The Price');
    expect(metadata.openGraph?.title).toBe('NoMarkup — The Market Sets The Price. Not The Markup.');
    expect(metadata.description).toContain(BUYER_PAYS_AGREED_PRICE);
    expect(metadata.openGraph?.description).toContain(BUYER_PAYS_AGREED_PRICE);
  });
});
