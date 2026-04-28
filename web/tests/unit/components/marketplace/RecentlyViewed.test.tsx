import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { RecentlyViewed } from '@/components/marketplace/RecentlyViewed';
import type { ListingDetail } from '@/types';

// In-memory localStorage shim — jsdom in this project doesn't expose Storage
// methods as callable functions. Mirrors the pattern from
// tests/unit/app/dashboard/admin-platform.test.tsx.
beforeAll(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => {
        store.clear();
      },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length(): number {
        return store.size;
      },
    },
  });
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    getPublic: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    userMessage(fallback: string) {
      return this.message || fallback;
    }
  },
}));

const { api } = (await import('@/lib/api')) as unknown as {
  api: { getPublic: ReturnType<typeof vi.fn> };
};

function makeDetail(over: Partial<ListingDetail> = {}): ListingDetail {
  return {
    id: 'd-1',
    seller_id: 's-1',
    category_id: 'cat',
    category_name: 'Furniture',
    category_slug: 'furniture',
    title: 'Recent listing',
    description: 'Detail',
    status: 'active',
    photos: [],
    pickup_zip: '78701',
    pickup_city: null,
    pickup_state: null,
    pickup_address: null,
    pickup_lat: null,
    pickup_lng: null,
    starting_price_cents: 1000,
    current_bid_cents: 1500,
    min_increment_cents: 100,
    bidder_count: 1,
    bid_count: 2,
    auction_duration_hours: 24,
    auction_ends_at: new Date(Date.now() + 3_600_000).toISOString(),
    snipe_extension_count: 0,
    distance_km: null,
    is_user_winning: false,
    was_outbid: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    seller_display_name: 'Alice',
    seller_member_since: new Date(Date.now() - 86_400_000).toISOString(),
    seller_listings_count: 1,
    seller_trust_tier: null,
    seller_trust_score: null,
    ...over,
  };
}

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

const STORAGE_KEY = 'nm:recently-viewed';

describe('RecentlyViewed', () => {
  beforeEach(() => {
    window.localStorage.clear();
    api.getPublic.mockReset();
  });
  afterEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it('renders nothing when localStorage is empty', () => {
    const { container } = render(<RecentlyViewed />, { wrapper: makeWrapper() });
    expect(container.querySelector('[data-testid="recently-viewed"]')).toBeNull();
  });

  it('renders the rail with one card per recently-viewed id', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { id: 'r-1', visitedAt: new Date().toISOString() },
        { id: 'r-2', visitedAt: new Date(Date.now() - 1000).toISOString() },
      ]),
    );
    api.getPublic.mockImplementation((path: string) => {
      const id = path.split('/').pop() ?? '';
      return Promise.resolve({ listing: makeDetail({ id, title: `Listing ${id}` }) });
    });

    render(<RecentlyViewed />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Listing r-1')).toBeDefined();
    });
    expect(screen.getByText('Listing r-2')).toBeDefined();
    const cards = screen.getAllByTestId('recently-viewed-card');
    expect(cards).toHaveLength(2);
  });

  it('renders cards as <a> links pointing at the marketplace detail route', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ id: 'r-click', visitedAt: new Date().toISOString() }]),
    );
    api.getPublic.mockResolvedValue({
      listing: makeDetail({ id: 'r-click', title: 'Click target' }),
    });

    render(<RecentlyViewed />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Click target')).toBeDefined();
    });
    const link = screen.getByText('Click target').closest('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/marketplace/r-click');
  });
});
