// useListings — the branches useListings.test.ts leaves untested: status-code
// specific failure copy (403 / 409 / 402 / money rewriting), the geo + zip
// search params, RSC `initialData` seeding, the trending rail, optimistic bid
// write + rollback, the offline-draft path of useCreateListingDraft, the
// `{ orders: null }` envelope, seller confirm and unpaid-order cancel.
//
// The real ApiError / getApiErrorMessage / forbiddenTransactMessage are kept
// (only the transport and the idempotency helpers are replaced) so the toast
// assertions exercise the genuine message mapping.
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useCancelUnpaidOrder,
  useConfirmPickup,
  useCreateListing,
  useCreateListingDraft,
  useListing,
  useListings,
  useMyListingBids,
  useMyOrders,
  usePlaceListingBid,
  useSellerConfirm,
  useTrendingListings,
} from '@/hooks/useListings';
import type { CreateListingInput, ListingDetail, ListingsResponse } from '@/types';

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

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      get: vi.fn(),
      getPublic: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
    idempotencyHeader: (key: string) => ({ 'Idempotency-Key': key }),
    clearIdempotencyKey: vi.fn(),
  };
});

vi.mock('@/lib/offline-drafts', () => ({
  saveDraft: vi.fn(),
}));

const { api, ApiError, clearIdempotencyKey } = await import('@/lib/api');
const { saveDraft } = await import('@/lib/offline-drafts');

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

function createWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

function rawListing(id: string, photos: unknown) {
  return { id, title: `Listing ${id}`, photos, current_bid_cents: 5000, bid_count: 2 };
}

const draftInput = { title: 'Offline sofa' } as unknown as CreateListingInput;

let queryClient: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = createTestQueryClient();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  queryClient.clear();
});

describe('listing failure copy by HTTP status', () => {
  interface FailureCase {
    name: string;
    error: unknown;
    toast: string;
  }

  const CASES: FailureCase[] = [
    {
      name: '403 without an account-gate code falls back to the seller copy',
      error: new ApiError(403, JSON.stringify({ error: 'forbidden' })),
      toast: 'Sellers cannot bid on their own listings.',
    },
    {
      name: '403 phone_not_verified surfaces the gate, not the seller copy',
      error: new ApiError(
        403,
        JSON.stringify({ code: 'phone_not_verified', error: 'Verify your phone first' }),
      ),
      toast: 'Verify your phone first',
    },
    {
      name: '409 without a conflictMessage keeps the auction-specific sentence',
      error: new ApiError(409, JSON.stringify({ error: 'listing is not active' })),
      toast: 'Bid rejected: auction not active, ended, or you already hold the high bid.',
    },
    {
      name: '402 asks for a bid bond',
      error: new ApiError(402, ''),
      toast: 'A bid bond is required before bidding on this listing.',
    },
    {
      name: 'other ApiError statuses show the server reason with cents rewritten to dollars',
      error: new ApiError(400, JSON.stringify({ error: 'bid must be at least 17200 cents' })),
      toast: 'bid must be at least $172.00',
    },
    {
      name: 'a non-ApiError failure shows the hook fallback',
      error: new TypeError('network down'),
      toast: 'Failed to create listing',
    },
  ];

  it.each(CASES)('$name', async ({ error, toast }) => {
    vi.mocked(api.post).mockRejectedValueOnce(error);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreateListing(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate(draftInput);

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(toast);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe('useListings search params + seeding', () => {
  it('sends zip, geo and price bounds — including 0 values — in the query string', async () => {
    vi.mocked(api.getPublic).mockResolvedValueOnce({ listings: [rawListing('l-1', null)] });
    const params = {
      category_slug: 'furniture',
      pickup_zip: '94110',
      lat: 0,
      lng: -122.4,
      radius_km: 40,
      min_price_cents: 0,
      max_price_cents: 9900,
      ending_soon: true,
    };

    const { result } = renderHook(() => useListings(params), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.getPublic)).toHaveBeenCalledWith(
      '/api/v1/listings?category_slug=furniture&pickup_zip=94110&radius_km=40&lat=0&lng=-122.4&min_price_cents=0&max_price_cents=9900&ending_soon=true',
    );
    // photos: null from the wire is normalized to an array.
    expect(result.current.data?.listings[0]?.photos).toEqual([]);
    expect(queryClient.getQueryData(['listings', 'search', params])).toEqual(result.current.data);
  });

  it('renders server-seeded initialData on first paint without waiting for the fetch', () => {
    const seed = { listings: [rawListing('seed', [])] } as unknown as ListingsResponse;
    vi.mocked(api.getPublic).mockReturnValueOnce(new Promise(() => undefined));

    const { result } = renderHook(() => useListings({}, { initialData: seed }), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.isSuccess).toBe(true);
    expect(result.current.data).toBe(seed);
  });

  it('useListing seeds the detail cache from initialData', () => {
    const seed = rawListing('l-9', []) as unknown as ListingDetail;
    vi.mocked(api.getPublic).mockReturnValueOnce(new Promise(() => undefined));

    const { result } = renderHook(() => useListing('l-9', { initialData: seed }), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.data).toBe(seed);
    expect(queryClient.getQueryData(['listings', 'l-9'])).toBe(seed);
  });
});

describe('useTrendingListings', () => {
  it('defaults to 12 rows and normalizes null photos', async () => {
    vi.mocked(api.getPublic).mockResolvedValueOnce({
      listings: [rawListing('t-1', null), rawListing('t-2', [{ id: 'p' }])],
    });

    const { result } = renderHook(() => useTrendingListings(), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.getPublic)).toHaveBeenCalledWith(
      '/api/v1/listings?sort_by=trending&page_size=12',
    );
    expect(result.current.data?.listings.map((l) => l.photos)).toEqual([[], [{ id: 'p' }]]);
    expect(queryClient.getQueryData(['listings', 'trending', 12])).toBeDefined();
  });

  it('uses the caller limit in both the URL and the query key', async () => {
    vi.mocked(api.getPublic).mockResolvedValueOnce({ listings: [] });

    const { result } = renderHook(() => useTrendingListings(4), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.getPublic)).toHaveBeenCalledWith(
      '/api/v1/listings?sort_by=trending&page_size=4',
    );
    expect(queryClient.getQueryData(['listings', 'trending', 4])).toEqual({ listings: [] });
    expect(queryClient.getQueryData(['listings', 'trending', 12])).toBeUndefined();
  });
});

describe('useMyListingBids', () => {
  it('paginates and normalizes the nested listing of each bid row', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      bids: [{ bid: { id: 'b-1' }, listing: rawListing('l-1', null) }],
    });

    const { result } = renderHook(() => useMyListingBids(3), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/listings/bids/mine?page=3');
    expect(result.current.data?.bids[0]?.listing.photos).toEqual([]);
    expect(queryClient.getQueryData(['listingBids', 'mine', 3])).toEqual(result.current.data);
  });
});

describe('usePlaceListingBid optimistic update', () => {
  const variables = { listingId: 'l-1', input: { amount_cents: 6000 } };

  it('writes the optimistic bid immediately and keeps it when the bid succeeds', async () => {
    queryClient.setQueryData(['listings', 'l-1'], rawListing('l-1', []));
    let settle: (value: { snipe_extension_applied: boolean }) => void = () => undefined;
    vi.mocked(api.post).mockReturnValueOnce(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );

    const { result } = renderHook(() => usePlaceListingBid(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate(variables);

    // Before the round-trip resolves the cache already shows the new top bid.
    await waitFor(() => {
      expect(queryClient.getQueryData<ListingDetail>(['listings', 'l-1'])?.current_bid_cents).toBe(
        6000,
      );
    });
    expect(queryClient.getQueryData<ListingDetail>(['listings', 'l-1'])?.bid_count).toBe(3);
    expect(result.current.isSuccess).toBe(false);

    settle({ snipe_extension_applied: true });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/listings/l-1/bids', variables.input, {
      'Idempotency-Key': 'listing-bid:l-1:6000',
    });
    expect(vi.mocked(clearIdempotencyKey)).toHaveBeenCalledWith('listing-bid:l-1:6000');
    expect(toastSuccess).toHaveBeenCalledWith(
      'Bid placed — auction extended due to last-minute bid',
    );
  });

  it('rolls the cache back to the snapshot when the bid is rejected', async () => {
    const before = rawListing('l-1', []);
    queryClient.setQueryData(['listings', 'l-1'], before);
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError(409, ''));

    const { result } = renderHook(() => usePlaceListingBid(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate(variables);

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(queryClient.getQueryData(['listings', 'l-1'])).toEqual(before);
    expect(toastError).toHaveBeenCalledWith(
      'Bid rejected: auction not active, ended, or you already hold the high bid.',
    );
    // The sticky key is kept on failure so a retry replays the same bid.
    expect(vi.mocked(clearIdempotencyKey)).not.toHaveBeenCalled();
  });

  it('does not invent a cache entry when no detail is cached', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => usePlaceListingBid(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate(variables);

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(queryClient.getQueryData(['listings', 'l-1'])).toBeUndefined();
    expect(toastError).toHaveBeenCalledWith('Failed to place bid');
  });
});

describe('useCreateListingDraft', () => {
  it('posts straight to the API while online and refreshes listings', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    vi.mocked(api.post).mockResolvedValueOnce({ id: 'l-new' });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreateListingDraft(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate(draftInput);
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/listings', draftInput);
    expect(vi.mocked(saveDraft)).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith('Listing created');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['listings'] });
  });

  it('treats a runtime without navigator (server render) as online', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ id: 'l-ssr' });

    const { result } = renderHook(() => useCreateListingDraft(), {
      wrapper: createWrapper(queryClient),
    });
    vi.stubGlobal('navigator', undefined);
    await result.current.mutateAsync(draftInput);
    vi.unstubAllGlobals();

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/listings', draftInput);
    expect(vi.mocked(saveDraft)).not.toHaveBeenCalled();
  });

  it('saves to IndexedDB under a UUID key while offline and never calls the API', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    vi.stubGlobal('crypto', { randomUUID: () => 'uuid-1234' });
    vi.mocked(saveDraft).mockResolvedValueOnce(undefined);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreateListingDraft(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate(draftInput);
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(saveDraft)).toHaveBeenCalledWith('uuid-1234', draftInput);
    expect(result.current.data).toEqual({ offline: true, key: 'uuid-1234' });
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith('Saved offline — will publish when you reconnect');
    // Nothing was published, so the listings cache is left alone.
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('falls back to a timestamp key when crypto.randomUUID is unavailable', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    vi.stubGlobal('crypto', {});
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    vi.mocked(saveDraft).mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useCreateListingDraft(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate(draftInput);
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(saveDraft)).toHaveBeenCalledWith('draft-1700000000000-250000', draftInput);
  });

  it('falls back to a timestamp key when crypto does not exist at all', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    vi.stubGlobal('crypto', undefined);
    vi.mocked(saveDraft).mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useCreateListingDraft(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate(draftInput);
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(saveDraft).mock.calls[0]?.[0]).toMatch(/^draft-\d+-\d+$/);
  });

  it('surfaces a failed offline save instead of claiming the draft was kept', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    vi.mocked(saveDraft).mockRejectedValueOnce(new Error('quota exceeded'));

    const { result } = renderHook(() => useCreateListingDraft(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate(draftInput);
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(toastError).toHaveBeenCalledWith('Failed to create listing');
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe('useMyOrders', () => {
  it('unwraps the { orders } envelope', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ orders: [{ id: 'o-1' }] });

    const { result } = renderHook(() => useMyOrders(), { wrapper: createWrapper(queryClient) });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/me/orders');
    expect(result.current.data).toEqual([{ id: 'o-1' }]);
    expect(queryClient.getQueryData(['listingOrders', 'mine'])).toEqual([{ id: 'o-1' }]);
  });

  it('turns orders: null into an empty array', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ orders: null });

    const { result } = renderHook(() => useMyOrders(), { wrapper: createWrapper(queryClient) });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([]);
  });
});

describe('pickup handshake', () => {
  it('useConfirmPickup does not claim escrow release until both sides confirmed', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ escrow_status: 'held', both_confirmed: false });

    const { result } = renderHook(() => useConfirmPickup(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate('o-1');
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(toastSuccess).toHaveBeenCalledWith(
      'Pickup confirmed — waiting on the seller to confirm before escrow releases',
    );
  });

  it('useSellerConfirm posts to seller-confirm and refreshes that order only', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ order: { id: 'o-2' } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useSellerConfirm(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate('o-2');
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/orders/o-2/seller-confirm');
    expect(toastSuccess).toHaveBeenCalledWith('Handoff confirmed');
    expect(invalidateSpy.mock.calls.map(([f]) => f?.queryKey)).toEqual([['listingOrders', 'o-2']]);
  });

  it('useSellerConfirm tells a buyer who hits the seller route why it failed', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError(500, 'x'.repeat(300)));

    const { result } = renderHook(() => useSellerConfirm(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate('o-2');
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // An oversized non-JSON body is not echoed to the user.
    expect(toastError).toHaveBeenCalledWith('Failed to confirm handoff');
  });
});

describe('useCancelUnpaidOrder', () => {
  it('posts with a per-order idempotency key and refreshes order, index and listing', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      order_id: 'o-3',
      listing_id: 'l-3',
      escrow_status: 'canceled',
      listing_status: 'active',
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCancelUnpaidOrder(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate('o-3');
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/orders/o-3/cancel-unpaid',
      {},
      { 'Idempotency-Key': 'order-cancel-unpaid:o-3' },
    );
    expect(vi.mocked(clearIdempotencyKey)).toHaveBeenCalledWith('order-cancel-unpaid:o-3');
    expect(toastSuccess).toHaveBeenCalledWith(
      'Unpaid order canceled. The listing is for sale again.',
    );
    expect(invalidateSpy.mock.calls.map(([f]) => f?.queryKey)).toEqual([
      ['listingOrders', 'o-3'],
      ['listingOrders', 'mine'],
      ['listings', 'l-3'],
    ]);
  });

  it('skips the listing refresh when the response carries no listing id', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      order_id: 'o-4',
      listing_id: '',
      escrow_status: 'canceled',
      listing_status: 'active',
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCancelUnpaidOrder(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate('o-4');
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(invalidateSpy.mock.calls.map(([f]) => f?.queryKey)).toEqual([
      ['listingOrders', 'o-4'],
      ['listingOrders', 'mine'],
    ]);
  });

  it('409 shows the service reason rather than the bid-rejected sentence', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(
      new ApiError(409, JSON.stringify({ error: 'payment captured; listing stays sold' })),
    );

    const { result } = renderHook(() => useCancelUnpaidOrder(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate('o-5');
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(toastError).toHaveBeenCalledWith('payment captured; listing stays sold');
    expect(vi.mocked(clearIdempotencyKey)).not.toHaveBeenCalled();
  });

  it('409 with an empty body uses the cancel-specific conflict fallback', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError(409, ''));

    const { result } = renderHook(() => useCancelUnpaidOrder(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate('o-6');
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(toastError).toHaveBeenCalledWith(
      'This order can no longer be canceled. If payment already went through, the listing stays sold.',
    );
  });
});
