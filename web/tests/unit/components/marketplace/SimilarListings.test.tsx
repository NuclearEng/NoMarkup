import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SimilarListings } from '@/components/marketplace/SimilarListings';
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
    id: 'l-1',
    seller_id: 's-1',
    category_id: 'cat',
    category_name: 'Furniture',
    category_slug: 'furniture',
    title: 'Eames lounge chair',
    description: 'Black leather, original',
    status: 'active',
    photos: [],
    pickup_zip: '94110',
    pickup_city: null,
    pickup_state: null,
    pickup_address: null,
    pickup_lat: null,
    pickup_lng: null,
    starting_price_cents: 100000,
    current_bid_cents: 120000,
    min_increment_cents: 100,
    bidder_count: 3,
    bid_count: 7,
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

describe('SimilarListings', () => {
  beforeEach(() => {
    api.getPublic.mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when the API returns an empty array', async () => {
    api.getPublic.mockResolvedValue({ listings: [] });
    const { container } = render(<SimilarListings listingId="abc" />, {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      // hidden when empty
      expect(container.querySelector('[data-testid="similar-listings"]')).toBeNull();
    });
  });

  it('shows the rail and renders listing cards when results exist', async () => {
    api.getPublic.mockResolvedValue({
      listings: [
        makeListing({ id: 'l-a', title: 'Eames ottoman' }),
        makeListing({ id: 'l-b', title: 'Aalto stool' }),
      ],
    });
    render(<SimilarListings listingId="abc" />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByText('Eames ottoman')).toBeDefined();
    });
    expect(screen.getByText('Aalto stool')).toBeDefined();
    // header is rendered
    expect(screen.getByText('You may also like')).toBeDefined();
  });

  it('hits /listings/{id}/similar with the correct path', async () => {
    api.getPublic.mockResolvedValue({ listings: [] });
    render(<SimilarListings listingId="xyz-123" />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(api.getPublic).toHaveBeenCalled();
    });
    const url = api.getPublic.mock.calls[0]?.[0] as string;
    expect(url).toContain('/api/v1/listings/xyz-123/similar');
    expect(url).toContain('limit=12');
  });

  it('shows an error state with Retry on failure', async () => {
    api.getPublic.mockRejectedValue(new Error('network down'));
    render(<SimilarListings listingId="abc" />, {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(api.getPublic).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByTestId('similar-listings-error')).toBeDefined();
    });
    expect(screen.getByText("Couldn't load similar listings")).toBeDefined();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined();
    expect(screen.getByTestId('similar-listings')).toBeDefined();
  });
});

