// useInstantMatch — branches useInstantMatch.test.ts leaves untested: the
// contract redirect after accepting an offer (and its absence), and every
// variant of the "instant match sent" copy, which must stay honest about how
// many providers were actually notified and when the offer expires.
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  formatApproxTravel,
  useAcceptOffer,
  useCreateInstantMatch,
  useDeclineOffer,
  useProviderOffers,
} from '@/hooks/useInstantMatch';

const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastMessage = vi.fn();
const routerPush = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => {
      toastSuccess(...a);
    },
    error: (...a: unknown[]) => {
      toastError(...a);
    },
    message: (...a: unknown[]) => {
      toastMessage(...a);
    },
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: (...a: unknown[]) => {
      routerPush(...a);
    },
  }),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      get: vi.fn(),
      post: vi.fn(),
    },
  };
});

const { api, ApiError } = await import('@/lib/api');

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

let queryClient: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = createTestQueryClient();
});

afterEach(() => {
  queryClient.clear();
});

describe('formatApproxTravel non-finite input', () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY])('returns null for %d', (minutes) => {
    expect(formatApproxTravel(minutes)).toBeNull();
  });

  it('rounds fractional minutes across the hour boundary', () => {
    expect(formatApproxTravel(59.6)).toBe('≈ 1h approx. travel');
    expect(formatApproxTravel(0.4)).toBe('≈ 0 min approx. travel');
  });
});

describe('useProviderOffers', () => {
  it('surfaces a failed inbox fetch and caches nothing', async () => {
    const failure = new ApiError(500, 'boom');
    vi.mocked(api.get).mockRejectedValueOnce(failure);

    const { result } = renderHook(() => useProviderOffers(), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/provider/offers');
    expect(result.current.error).toBe(failure);
    expect(queryClient.getQueryData(['provider-offers'])).toBeUndefined();
  });
});

describe('useAcceptOffer', () => {
  it('routes straight to the minted contract and refreshes offers + contracts', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ status: 'accepted', contract_id: 'ct-9' });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useAcceptOffer('job-1'), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate();
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/provider/offers/job-1/accept');
    expect(routerPush).toHaveBeenCalledTimes(1);
    expect(routerPush).toHaveBeenCalledWith('/contracts/ct-9');
    expect(invalidateSpy.mock.calls.map(([f]) => f?.queryKey)).toEqual([
      ['provider-offers'],
      ['contracts'],
    ]);
  });

  it.each([{ status: 'accepted' }, { status: 'accepted', contract_id: '' }])(
    'stays on the page when the response is %j',
    async (body) => {
      vi.mocked(api.post).mockResolvedValueOnce(body);

      const { result } = renderHook(() => useAcceptOffer('job-1'), {
        wrapper: createWrapper(queryClient),
      });
      result.current.mutate();
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(routerPush).not.toHaveBeenCalled();
      expect(toastSuccess).toHaveBeenCalledWith(
        'Offer accepted! A contract is ready for you to review.',
      );
    },
  );

  it('shows the gateway reason and does not navigate when the offer expired', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(
      new ApiError(410, JSON.stringify({ error: 'offer expired' })),
    );
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useAcceptOffer('job-1'), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate();
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(toastError).toHaveBeenCalledWith('offer expired');
    expect(routerPush).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('falls back to the expiry hint for a failure with no message', async () => {
    vi.mocked(api.post).mockRejectedValueOnce('nope');

    const { result } = renderHook(() => useAcceptOffer('job-1'), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate();
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(toastError).toHaveBeenCalledWith('Failed to accept offer. It may have already expired.');
  });
});

describe('useDeclineOffer', () => {
  it('refreshes only the offers inbox, never contracts', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ status: 'declined' });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useDeclineOffer('job-2'), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate();
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/provider/offers/job-2/decline');
    expect(toastSuccess).toHaveBeenCalledWith('Offer declined.');
    expect(invalidateSpy.mock.calls.map(([f]) => f?.queryKey)).toEqual([['provider-offers']]);
  });
});

describe('useCreateInstantMatch result copy', () => {
  const ISO = '2026-11-20T18:30:00Z';
  // Same formatting call as the hook, so the assertion holds in any locale/TZ.
  const LABEL = new Date(ISO).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  interface CopyCase {
    name: string;
    body: Record<string, unknown>;
    channel: 'success' | 'message';
    text: string;
  }

  const CASES: CopyCase[] = [
    {
      name: 'zero providers with an expiry is a neutral notice, not a success',
      body: { status: 'open', expires_at: ISO, providers_notified: 0 },
      channel: 'message',
      text: `Instant offer is live until ${LABEL}, but no providers are currently available for Instant. Keep the auction open or re-request later.`,
    },
    {
      name: 'zero providers without an expiry',
      body: { status: 'open', expires_at: '', providers_notified: 0 },
      channel: 'message',
      text: 'Instant offer is live, but no providers are currently available for Instant. Keep the auction open or re-request later.',
    },
    {
      name: 'one provider is singular',
      body: { status: 'open', expires_at: ISO, providers_notified: 1 },
      channel: 'success',
      text: `Instant match sent to 1 available provider. Offers expire ${LABEL}.`,
    },
    {
      name: 'several providers are plural',
      body: { status: 'open', expires_at: ISO, providers_notified: 4 },
      channel: 'success',
      text: `Instant match sent to 4 available providers. Offers expire ${LABEL}.`,
    },
    {
      name: 'one provider without an expiry',
      body: { status: 'open', expires_at: '', providers_notified: 1 },
      channel: 'success',
      text: 'Instant match sent to 1 available provider.',
    },
    {
      name: 'several providers without an expiry',
      body: { status: 'open', expires_at: '', providers_notified: 3 },
      channel: 'success',
      text: 'Instant match sent to 3 available providers.',
    },
    {
      name: 'an unknown count makes no claim about providers',
      body: { status: 'open', expires_at: ISO },
      channel: 'success',
      text: `Instant match sent. Offers expire ${LABEL}.`,
    },
    {
      name: 'a negative count is treated as unknown',
      body: { status: 'open', expires_at: ISO, providers_notified: -1 },
      channel: 'success',
      text: `Instant match sent. Offers expire ${LABEL}.`,
    },
    {
      name: 'a non-numeric count is treated as unknown',
      body: { status: 'open', expires_at: '', providers_notified: '5' },
      channel: 'success',
      text: 'Instant match sent. Providers with Instant availability will see the offer.',
    },
    {
      name: 'an unparseable expiry is shown verbatim rather than as "Invalid Date"',
      body: { status: 'open', expires_at: 'soon', providers_notified: 2 },
      channel: 'success',
      text: 'Instant match sent to 2 available providers. Offers expire soon.',
    },
  ];

  it.each(CASES)('$name', async ({ body, channel, text }) => {
    vi.mocked(api.post).mockResolvedValueOnce(body);

    const { result } = renderHook(() => useCreateInstantMatch('job-5'), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate();
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/jobs/job-5/instant-match');
    const [used, unused] =
      channel === 'success' ? [toastSuccess, toastMessage] : [toastMessage, toastSuccess];
    expect(used).toHaveBeenCalledTimes(1);
    expect(used).toHaveBeenCalledWith(text);
    expect(unused).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('shows the gateway reason when the match cannot start', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(
      new ApiError(409, JSON.stringify({ error: 'job already has an instant offer' })),
    );

    const { result } = renderHook(() => useCreateInstantMatch('job-5'), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate();
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(toastError).toHaveBeenCalledWith('job already has an instant offer');
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastMessage).not.toHaveBeenCalled();
  });
});
