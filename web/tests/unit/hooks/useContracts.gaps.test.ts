// useContracts — the pieces useContracts.test.ts never calls: the
// hydration-safe acceptance-expiry hook (server render vs mounted, the
// once-a-minute re-check), the party-only job location query, and the two
// change-order mutations.
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resolvePartyDirectionsAddress,
  useAcceptanceExpired,
  usePartyJobLocation,
  useProposeChangeOrder,
  useRespondToChangeOrder,
} from '@/hooks/useContracts';

import { type QueryHarness, createQueryHarness } from './_gaps-query-harness';

const mocks = vi.hoisted(() => ({
  get: vi.fn<(path: string) => Promise<unknown>>(),
  post: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
  put: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { get: mocks.get, post: mocks.post, put: mocks.put } };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { ApiError } = await import('@/lib/api');
const { toast } = await import('sonner');

let h: QueryHarness;

beforeEach(() => {
  vi.clearAllMocks();
  h = createQueryHarness();
});

afterEach(() => {
  vi.useRealTimers();
  h.queryClient.clear();
});

describe('useAcceptanceExpired', () => {
  const NOW = new Date('2026-03-01T12:00:00Z');
  const PAST = '2026-03-01T11:00:00Z';
  const SOON = '2026-03-01T12:00:30Z';

  function Probe({ status, deadline }: { status: string; deadline: string | null }) {
    return createElement('span', null, String(useAcceptanceExpired(status, deadline)));
  }

  it('renders "not expired" on the server even for a past deadline (no clock read before mount)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const html = renderToString(
      createElement(Probe, { status: 'pending_acceptance', deadline: PAST }),
    );
    expect(html).toContain('false');
    expect(html).not.toContain('true');
  });

  it('reports expired once mounted for a pending contract past its deadline', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { result } = renderHook(() => useAcceptanceExpired('pending_acceptance', PAST));
    expect(result.current).toBe(true);
  });

  it.each([
    ['a contract that is no longer pending', 'active', PAST],
    ['a missing deadline', 'pending_acceptance', null],
    ['an unparseable deadline', 'pending_acceptance', 'not-a-date'],
    ['a deadline still in the future', 'pending_acceptance', SOON],
  ])('is false for %s', (_name, status, deadline) => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { result } = renderHook(() => useAcceptanceExpired(status, deadline));
    expect(result.current).toBe(false);
  });

  it('flips to expired on the next minute tick when the deadline passes while the page is open', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { result } = renderHook(() => useAcceptanceExpired('pending_acceptance', SOON));
    expect(result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    expect(result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current).toBe(true);
  });

  it('stops its timer on unmount', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { unmount } = renderHook(() => useAcceptanceExpired('pending_acceptance', SOON));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('resolvePartyDirectionsAddress', () => {
  it('returns null for a missing job', () => {
    expect(resolvePartyDirectionsAddress(null)).toBeNull();
    expect(resolvePartyDirectionsAddress(undefined)).toBeNull();
  });

  it('prefers the exact address when it is routable', () => {
    expect(
      resolvePartyDirectionsAddress({
        exact_address: { street: '1 Main St', city: 'Austin', state: 'TX', zip_code: '78701' },
        location_address: 'Austin, TX',
        location_lat: 30.2,
        location_lng: -97.7,
      }),
    ).toBe('1 Main St, Austin, TX, 78701');
  });

  it('falls back to the location line when the exact address is too thin', () => {
    expect(
      resolvePartyDirectionsAddress({
        exact_address: { city: 'Austin' },
        location_address: '  Austin, TX  ',
      }),
    ).toBe('Austin, TX');
  });

  it('falls back to coordinates when the location line is too short', () => {
    expect(
      resolvePartyDirectionsAddress({ location_address: 'TX', location_lat: 30.2, location_lng: -97.7 }),
    ).toBe('30.2,-97.7');
  });

  it('returns null when nothing usable is present', () => {
    expect(resolvePartyDirectionsAddress({ location_address: null, location_lat: 30.2 })).toBeNull();
  });
});

describe('usePartyJobLocation', () => {
  it('reads the job from a `{ job }` envelope', async () => {
    mocks.get.mockResolvedValue({ job: { exact_address: { street: '9 Elm St' } } });

    const { result } = renderHook(() => usePartyJobLocation('job-1'), { wrapper: h.wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(mocks.get).toHaveBeenCalledWith('/api/v1/jobs/job-1');
    expect(result.current.data).toBe('9 Elm St');
    expect(h.queryClient.getQueryData(['jobs', 'job-1', 'party-location'])).toBe('9 Elm St');
  });

  it('reads a flat job payload', async () => {
    mocks.get.mockResolvedValue({ location_address: 'Denver, CO' });

    const { result } = renderHook(() => usePartyJobLocation('job-1'), { wrapper: h.wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toBe('Denver, CO');
  });

  it('resolves to null when the job has no usable location', async () => {
    mocks.get.mockResolvedValue({ job: {} });

    const { result } = renderHook(() => usePartyJobLocation('job-1'), { wrapper: h.wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toBeNull();
  });

  it.each([
    ['no job id', '', true],
    ['enabled=false', 'job-1', false],
  ])('does not fetch with %s', (_name, jobId, enabled) => {
    const { result } = renderHook(() => usePartyJobLocation(jobId, enabled), { wrapper: h.wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('does not retry a forbidden (non-party) request', async () => {
    mocks.get.mockRejectedValue(new ApiError(403, '{"error":"forbidden"}'));

    const { result } = renderHook(() => usePartyJobLocation('job-1'), { wrapper: h.wrapper });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
});

describe('useProposeChangeOrder', () => {
  const variables = { contractId: 'c-1', description: 'Add a second coat', amount_delta_cents: 15_000 };

  it('POSTs description + delta (not the contract id) and refreshes that contract', async () => {
    mocks.post.mockResolvedValue({ id: 'co-1' });
    const { result } = renderHook(() => useProposeChangeOrder(), { wrapper: h.wrapper });

    await result.current.mutateAsync(variables);

    expect(mocks.post).toHaveBeenCalledWith('/api/v1/contracts/c-1/change-orders', {
      description: 'Add a second coat',
      amount_delta_cents: 15_000,
    });
    expect(toast.success).toHaveBeenCalledWith('Change order proposed');
    expect(h.invalidatedKeys()).toEqual([['contract', 'c-1']]);
  });

  it('toasts the gateway reason on an ApiError and the fallback otherwise', async () => {
    mocks.post
      .mockRejectedValueOnce(new ApiError(409, '{"error":"contract is not active"}'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useProposeChangeOrder(), { wrapper: h.wrapper });

    await expect(result.current.mutateAsync(variables)).rejects.toBeInstanceOf(ApiError);
    await expect(result.current.mutateAsync(variables)).rejects.toBeInstanceOf(TypeError);

    expect(vi.mocked(toast.error).mock.calls.map((c) => c[0])).toEqual([
      'contract is not active',
      'Failed to propose change order',
    ]);
    expect(h.invalidatedKeys()).toEqual([]);
  });
});

describe('useRespondToChangeOrder', () => {
  it.each([
    { accepted: true, message: 'Change order approved' },
    { accepted: false, message: 'Change order rejected' },
  ])('accepted=$accepted → "$message"; refreshes the contract and the list', async ({ accepted, message }) => {
    mocks.put.mockResolvedValue({});
    const { result } = renderHook(() => useRespondToChangeOrder(), { wrapper: h.wrapper });

    await result.current.mutateAsync({ contractId: 'c-1', changeOrderId: 'co-1', accepted });

    expect(mocks.put).toHaveBeenCalledWith('/api/v1/contracts/c-1/change-orders/co-1', { accepted });
    expect(toast.success).toHaveBeenCalledWith(message);
    expect(h.invalidatedKeys()).toEqual([['contract', 'c-1'], ['contracts']]);
  });

  it('toasts the gateway reason on failure and announces nothing', async () => {
    mocks.put.mockRejectedValue(new ApiError(403, '{"error":"only the customer can respond"}'));
    const { result } = renderHook(() => useRespondToChangeOrder(), { wrapper: h.wrapper });

    await expect(
      result.current.mutateAsync({ contractId: 'c-1', changeOrderId: 'co-1', accepted: true }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(toast.error).toHaveBeenCalledWith('only the customer can respond');
    expect(toast.success).not.toHaveBeenCalled();
    expect(h.invalidatedKeys()).toEqual([]);
  });
});
