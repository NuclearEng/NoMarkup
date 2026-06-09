import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useCancelListing,
  useConfirmPickup,
  useCreateListing,
  useDeleteListingDraft,
  useDisputeOrder,
  useListing,
  useListingBids,
  useListingOrder,
  useListings,
  useMyListingBids,
  useMyListings,
  usePlaceListingBid,
  useUpdateListing,
} from '@/hooks/useListings';
import type { Listing, ListingDetail, ListingOrder } from '@/types';

const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => {
      toastSuccess(...a);
    },
    error: (...a: unknown[]) => {
      toastError(...a);
    },
  },
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

const { api, ApiError } = (await import('@/lib/api')) as unknown as {
  api: {
    get: ReturnType<typeof vi.fn>;
    getPublic: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    patch: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  ApiError: new (message: string) => Error & { userMessage: (fallback: string) => string };
};

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function createWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

const mockListing: Listing = {
  id: 'l-1',
  seller_id: 's-1',
  category_id: 'cat',
  category_name: 'Furniture',
  category_slug: 'furniture',
  title: 'Sofa',
  description: 'A sofa',
  status: 'active',
  photos: [],
  pickup_zip: '94110',
  pickup_city: null,
  pickup_state: null,
  pickup_address: null,
  pickup_lat: null,
  pickup_lng: null,
  starting_price_cents: 5000,
  current_bid_cents: 5500,
  min_increment_cents: 100,
  bidder_count: 1,
  bid_count: 1,
  auction_duration_hours: 48,
  auction_ends_at: new Date(Date.now() + 86_400_000).toISOString(),
  snipe_extension_count: 0,
  distance_km: null,
  is_user_winning: false,
  was_outbid: false,
  created_at: '2026-04-20T00:00:00Z',
  updated_at: '2026-04-20T00:00:00Z',
};

const mockDetail: ListingDetail = {
  ...mockListing,
  seller_display_name: 'Jane',
  seller_member_since: '2024-01-01T00:00:00Z',
  seller_listings_count: 5,
  seller_trust_tier: 'trusted',
  seller_trust_score: 0.9,
};

describe('useListings', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });
  afterEach(() => {
    queryClient.clear();
  });

  it('queries the listings search endpoint with no filters', async () => {
    vi.mocked(api.getPublic).mockResolvedValueOnce({
      listings: [mockListing],
      pagination: { totalCount: 1, page: 1, pageSize: 12, totalPages: 1, hasNext: false },
    });
    const { result } = renderHook(() => useListings({}), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(api.getPublic).toHaveBeenCalledWith('/api/v1/listings');
    expect(result.current.data?.listings).toHaveLength(1);
  });

  it('builds query string from filter params', async () => {
    vi.mocked(api.getPublic).mockResolvedValueOnce({
      listings: [],
      pagination: { totalCount: 0, page: 1, pageSize: 12, totalPages: 0, hasNext: false },
    });
    const { result } = renderHook(
      () =>
        useListings({
          query: 'sofa',
          category_id: 'cat-1',
          pickup_zip: '94110',
          radius_km: 25,
          min_price_cents: 1000,
          max_price_cents: 50000,
          ending_soon: true,
          sort_by: 'ending_soon',
          page: 2,
          page_size: 24,
        }),
      { wrapper: createWrapper(queryClient) },
    );
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    const calls = vi.mocked(api.getPublic).mock.calls;
    const path = String(calls[0]?.[0] ?? '');
    expect(path).toContain('q=sofa');
    expect(path).toContain('category_id=cat-1');
    expect(path).toContain('pickup_zip=94110');
    expect(path).toContain('radius_km=25');
    expect(path).toContain('min_price_cents=1000');
    expect(path).toContain('max_price_cents=50000');
    expect(path).toContain('ending_soon=true');
    expect(path).toContain('sort_by=ending_soon');
    expect(path).toContain('page=2');
    expect(path).toContain('page_size=24');
  });
});

describe('useListing', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  it('fetches the listing detail when id is provided', async () => {
    vi.mocked(api.getPublic).mockResolvedValueOnce({ listing: mockDetail });
    const { result } = renderHook(() => useListing('l-1'), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(api.getPublic).toHaveBeenCalledWith('/api/v1/listings/l-1');
    expect(result.current.data?.id).toBe('l-1');
  });

  it('does not query when id is empty', () => {
    renderHook(() => useListing(''), { wrapper: createWrapper(queryClient) });
    expect(api.getPublic).not.toHaveBeenCalled();
  });
});

describe('useListingBids', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  it('fetches bid history', async () => {
    vi.mocked(api.getPublic).mockResolvedValueOnce({
      bids: [],
      current_bid_cents: 0,
      bidder_count: 0,
    });
    const { result } = renderHook(() => useListingBids('l-1'), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(api.getPublic).toHaveBeenCalledWith('/api/v1/listings/l-1/bids');
  });
});

describe('useMyListings', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  it('attaches status filter and page', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      listings: [],
      pagination: { totalCount: 0, page: 1, pageSize: 12, totalPages: 0, hasNext: false },
    });
    const { result } = renderHook(() => useMyListings('active', 2), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(api.get).toHaveBeenCalledWith('/api/v1/listings/mine?status=active&page=2');
  });

  it('omits filters when not provided', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      listings: [],
      pagination: { totalCount: 0, page: 1, pageSize: 12, totalPages: 0, hasNext: false },
    });
    const { result } = renderHook(() => useMyListings(), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(api.get).toHaveBeenCalledWith('/api/v1/listings/mine');
  });
});

describe('useMyListingBids', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  it('queries the bids/mine endpoint', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      bids: [],
      pagination: { totalCount: 0, page: 1, pageSize: 12, totalPages: 0, hasNext: false },
    });
    const { result } = renderHook(() => useMyListingBids(), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(api.get).toHaveBeenCalledWith('/api/v1/listings/bids/mine');
  });
});

describe('useCreateListing', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  it('posts a new listing and invalidates listings cache', async () => {
    vi.mocked(api.post).mockResolvedValueOnce(mockListing);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateListing(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({
      category_id: 'cat',
      title: 'Test',
      description: 'desc',
      photo_urls: ['https://x'],
      pickup_zip: '94110',
      starting_price_cents: 5000,
      auction_duration_hours: 48,
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(api.post).toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['listings'] });
    expect(toastSuccess).toHaveBeenCalledWith('Listing created');
  });

  it('shows ApiError userMessage on failure', async () => {
    const err = new ApiError('Not allowed');
    vi.mocked(api.post).mockRejectedValueOnce(err);
    const { result } = renderHook(() => useCreateListing(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({
      category_id: 'cat',
      title: 'Test',
      description: 'desc',
      photo_urls: ['https://x'],
      pickup_zip: '94110',
      starting_price_cents: 5000,
      auction_duration_hours: 48,
    });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(toastError).toHaveBeenCalledWith('Not allowed');
  });

  it('uses fallback toast on non-Api error', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useCreateListing(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({
      category_id: 'cat',
      title: 'Test',
      description: 'desc',
      photo_urls: ['https://x'],
      pickup_zip: '94110',
      starting_price_cents: 5000,
      auction_duration_hours: 48,
    });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(toastError).toHaveBeenCalledWith('Failed to create listing');
  });
});

describe('useUpdateListing / useCancelListing / useDeleteListingDraft', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  it('useUpdateListing patches the listing', async () => {
    vi.mocked(api.patch).mockResolvedValueOnce(mockListing);
    const { result } = renderHook(() => useUpdateListing(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({ id: 'l-1', input: { title: 'New' } });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(api.patch).toHaveBeenCalledWith('/api/v1/listings/l-1', { title: 'New' });
  });

  it('useCancelListing posts cancel and invalidates', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({});
    const { result } = renderHook(() => useCancelListing(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate('l-1');
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(api.post).toHaveBeenCalledWith('/api/v1/listings/l-1/cancel');
  });

  it('useDeleteListingDraft deletes the draft', async () => {
    vi.mocked(api.delete).mockResolvedValueOnce({});
    const { result } = renderHook(() => useDeleteListingDraft(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate('l-1');
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(api.delete).toHaveBeenCalledWith('/api/v1/listings/l-1');
  });
});

describe('usePlaceListingBid', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  it('places a bid and invalidates the listing query', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      bid: {
        id: 'b-1',
        listing_id: 'l-1',
        bidder_id: 'me',
        bidder_display_name: 'Me',
        amount_cents: 6000,
        is_winning: true,
        created_at: new Date().toISOString(),
      },
      current_bid_cents: 6000,
      bidder_count: 2,
      snipe_extension_applied: false,
      new_auction_ends_at: null,
    });

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => usePlaceListingBid(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ listingId: 'l-1', input: { amount_cents: 6000 } });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(api.post).toHaveBeenCalledWith('/api/v1/listings/l-1/bids', { amount_cents: 6000 });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['listings', 'l-1'] });
    expect(toastSuccess).toHaveBeenCalledWith('Bid placed — you are the highest bidder');
  });

  it('uses snipe-extension toast when extension was applied', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      bid: {
        id: 'b-1',
        listing_id: 'l-1',
        bidder_id: 'me',
        bidder_display_name: 'Me',
        amount_cents: 6000,
        is_winning: true,
        created_at: new Date().toISOString(),
      },
      current_bid_cents: 6000,
      bidder_count: 2,
      snipe_extension_applied: true,
      new_auction_ends_at: new Date(Date.now() + 60_000).toISOString(),
    });

    const { result } = renderHook(() => usePlaceListingBid(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ listingId: 'l-1', input: { amount_cents: 6000 } });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(toastSuccess).toHaveBeenCalledWith(
      'Bid placed — auction extended due to last-minute bid',
    );
  });

  it('reports user-friendly errors on failure', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError('Bid too low'));
    const { result } = renderHook(() => usePlaceListingBid(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({ listingId: 'l-1', input: { amount_cents: 1 } });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(toastError).toHaveBeenCalledWith('Bid too low');
  });
});

describe('useListingOrder / useConfirmPickup / useDisputeOrder', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  const mockOrder: ListingOrder = {
    id: 'o-1',
    listing_id: 'l-1',
    listing_title: 'Sofa',
    listing_photo_url: null,
    buyer_id: 'me',
    seller_id: 's-1',
    seller_display_name: 'Jane',
    pickup_address: '123 Main St',
    pickup_zip: '94110',
    pickup_city: 'San Francisco',
    pickup_state: 'CA',
    amount_cents: 6000,
    platform_fee_cents: 600,
    status: 'paid',
    channel_id: 'ch-1',
    paid_at: new Date().toISOString(),
    picked_up_at: null,
    completed_at: null,
    dispute_window_ends_at: null,
    created_at: new Date().toISOString(),
  };

  it('useListingOrder fetches the order detail', async () => {
    // Gateway returns the order at the top level (not a { order } envelope).
    vi.mocked(api.get).mockResolvedValueOnce(mockOrder);
    const { result } = renderHook(() => useListingOrder('o-1'), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(api.get).toHaveBeenCalledWith('/api/v1/orders/o-1');
    expect(result.current.data?.id).toBe('o-1');
  });

  it('useConfirmPickup posts the confirm endpoint', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ order: mockOrder });
    const { result } = renderHook(() => useConfirmPickup(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate('o-1');
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(api.post).toHaveBeenCalledWith('/api/v1/orders/o-1/confirm-pickup');
    expect(toastSuccess).toHaveBeenCalledWith('Pickup confirmed — escrow released to seller');
  });

  it('useDisputeOrder posts the file-dispute endpoint with reason enum + description', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ order: mockOrder });
    const { result } = renderHook(() => useDisputeOrder(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({
      orderId: 'o-1',
      reason: 'item_damaged',
      description: 'Item was damaged on arrival and unusable.',
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(api.post).toHaveBeenCalledWith('/api/v1/orders/o-1/file-dispute', {
      reason: 'item_damaged',
      description: 'Item was damaged on arrival and unusable.',
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      'Dispute opened — our team will review within 24h',
    );
  });
});
