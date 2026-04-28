import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TrendingRail } from '@/components/marketplace/TrendingRail';
import type { Listing } from '@/types';

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

function makeListing(over: Partial<Listing> = {}): Listing {
  return {
    id: 't-1',
    seller_id: 's-1',
    category_id: 'cat',
    category_name: 'Furniture',
    category_slug: 'furniture',
    title: 'Trending lamp',
    description: 'Cool lamp',
    status: 'active',
    photos: [],
    pickup_zip: '78701',
    pickup_city: null,
    pickup_state: null,
    pickup_address: null,
    pickup_lat: null,
    pickup_lng: null,
    starting_price_cents: 1000,
    current_bid_cents: 5000,
    min_increment_cents: 100,
    bidder_count: 4,
    bid_count: 12,
    auction_duration_hours: 24,
    auction_ends_at: new Date(Date.now() + 3_600_000).toISOString(),
    snipe_extension_count: 0,
    distance_km: null,
    is_user_winning: false,
    was_outbid: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
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

describe('TrendingRail', () => {
  beforeEach(() => {
    api.getPublic.mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('hides itself when the API returns an empty listings array', async () => {
    api.getPublic.mockResolvedValue({ listings: [], pagination: {} });
    const { container } = render(<TrendingRail />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(api.getPublic).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(container.querySelector('[data-testid="trending-rail"]')).toBeNull();
    });
  });

  it('renders the rail and the listings when results exist', async () => {
    api.getPublic.mockResolvedValue({
      listings: [
        makeListing({ id: 't-a', title: 'Hot mid-century chair' }),
        makeListing({ id: 't-b', title: 'Vintage Polaroid' }),
      ],
      pagination: {},
    });
    render(<TrendingRail />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByText('Hot mid-century chair')).toBeDefined();
    });
    expect(screen.getByText('Vintage Polaroid')).toBeDefined();
    expect(screen.getByText('Trending now')).toBeDefined();
  });

  it('hides the rail on error', async () => {
    api.getPublic.mockRejectedValue(new Error('500 boom'));
    const { container } = render(<TrendingRail />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(api.getPublic).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(container.querySelector('[data-testid="trending-rail"]')).toBeNull();
    });
  });
});
