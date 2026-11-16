// Tests for the professional-license hooks (legal vertical).
//
// The interesting behaviour here is all in the error handling: a provider with
// no licenses must render an empty capture form rather than an error state, a
// missing public license must not break the profile badge, and the admin review
// mutation must surface the gateway's real reason on failure.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ADMIN_LICENSE_FILTER,
  LICENSE_STATUS,
  LICENSE_TYPE,
  hasVerifiedBarLicense,
  useAdminLicenses,
  useMyLicenses,
  useProviderLicenses,
  useReviewLicense,
  useSubmitLicense,
  type AdminLicensesResponse,
  type ProviderLicense,
  type PublicProviderLicense,
} from '@/hooks/useProviderLicenses';

const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => {
      toastSuccess(...args);
    },
    error: (...args: unknown[]) => {
      toastError(...args);
    },
  },
}));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: {
      get: vi.fn(),
      getPublic: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { api, ApiError } = await import('@/lib/api');

function qc(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}

function wrap(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

const myLicense: ProviderLicense = {
  id: 'lic-1',
  license_type: LICENSE_TYPE.BAR,
  license_number: '1234567',
  jurisdiction: 'CA',
  status: LICENSE_STATUS.PENDING,
};

const publicLicense: PublicProviderLicense = {
  id: 'lic-1',
  provider_id: 'p-1',
  license_type: LICENSE_TYPE.BAR,
  license_number: '••••4567',
  jurisdiction: 'CA',
  status: LICENSE_STATUS.VERIFIED,
  created_at: '2026-04-01T00:00:00Z',
  updated_at: '2026-04-02T00:00:00Z',
};

let client: QueryClient;

beforeEach(() => {
  vi.resetAllMocks();
  client = qc();
});

afterEach(() => {
  client.clear();
});

describe('useMyLicenses', () => {
  it('returns the provider’s own licenses', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ licenses: [myLicense] });

    const { result } = renderHook(() => useMyLicenses(), { wrapper: wrap(client) });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([myLicense]);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/providers/me/licenses');
  });

  it('normalizes a null licenses array to an empty list', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ licenses: null });

    const { result } = renderHook(() => useMyLicenses(), { wrapper: wrap(client) });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([]);
  });

  it('treats a 404 (no provider profile yet) as an empty list, not an error', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new ApiError(404, '{"error":"not found"}'));

    const { result } = renderHook(() => useMyLicenses(), { wrapper: wrap(client) });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([]);
    expect(result.current.isError).toBe(false);
  });

  it('retries a non-404 failure once, then propagates it', async () => {
    vi.mocked(api.get).mockRejectedValue(new ApiError(500, 'boom'));

    const { result } = renderHook(() => useMyLicenses(), { wrapper: wrap(client) });
    await waitFor(
      () => {
        expect(result.current.isError).toBe(true);
      },
      { timeout: 5000 },
    );

    // The hook's own `retry` predicate allows exactly one retry for a
    // transient server error (it overrides the client-level retry: false).
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 404 — an unregistered provider is a settled answer', async () => {
    vi.mocked(api.get).mockRejectedValue(new ApiError(404, 'not found'));

    const { result } = renderHook(() => useMyLicenses(), { wrapper: wrap(client) });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(1);
  });
});

describe('useSubmitLicense', () => {
  it('POSTs the license and refreshes the provider’s own list', async () => {
    vi.mocked(api.post).mockResolvedValueOnce(myLicense);
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useSubmitLicense(), { wrapper: wrap(client) });
    result.current.mutate({
      license_type: LICENSE_TYPE.BAR,
      license_number: '1234567',
      jurisdiction: 'CA',
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/providers/me/licenses', {
      license_type: LICENSE_TYPE.BAR,
      license_number: '1234567',
      jurisdiction: 'CA',
    });
    expect(toastSuccess).toHaveBeenCalledWith('License submitted for verification');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['providerLicenses', 'me'] });
  });

  it('surfaces the gateway’s reason when the submit is rejected', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(
      new ApiError(409, '{"error":"license already submitted"}'),
    );

    const { result } = renderHook(() => useSubmitLicense(), { wrapper: wrap(client) });
    result.current.mutate({
      license_type: LICENSE_TYPE.BAR,
      license_number: '1234567',
      jurisdiction: 'CA',
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(toastError).toHaveBeenCalledWith('license already submitted');
  });

  it('falls back to a generic message for a non-ApiError failure', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('network down'));

    const { result } = renderHook(() => useSubmitLicense(), { wrapper: wrap(client) });
    result.current.mutate({
      license_type: LICENSE_TYPE.BAR,
      license_number: '1234567',
      jurisdiction: 'CA',
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(toastError).toHaveBeenCalledWith('Could not submit license');
  });
});

describe('useProviderLicenses (public)', () => {
  it('reads another provider’s verified licenses over the public client', async () => {
    vi.mocked(api.getPublic).mockResolvedValueOnce({ licenses: [publicLicense] });

    const { result } = renderHook(() => useProviderLicenses('p-1'), { wrapper: wrap(client) });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([publicLicense]);
    expect(vi.mocked(api.getPublic)).toHaveBeenCalledWith('/api/v1/providers/p-1/licenses');
  });

  it('normalizes a null list to an empty array', async () => {
    vi.mocked(api.getPublic).mockResolvedValueOnce({ licenses: null });

    const { result } = renderHook(() => useProviderLicenses('p-1'), { wrapper: wrap(client) });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([]);
  });

  it('treats a 404 as "no badge" rather than an error on a public profile', async () => {
    vi.mocked(api.getPublic).mockRejectedValueOnce(new ApiError(404, 'not found'));

    const { result } = renderHook(() => useProviderLicenses('p-1'), { wrapper: wrap(client) });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([]);
  });

  it('propagates a non-404 failure', async () => {
    vi.mocked(api.getPublic).mockRejectedValueOnce(new ApiError(503, 'down'));

    const { result } = renderHook(() => useProviderLicenses('p-1'), { wrapper: wrap(client) });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });

  it('does not fetch without a provider id', () => {
    const { result } = renderHook(() => useProviderLicenses(''), { wrapper: wrap(client) });

    expect(result.current.fetchStatus).toBe('idle');
    expect(vi.mocked(api.getPublic)).not.toHaveBeenCalled();
  });
});

describe('hasVerifiedBarLicense', () => {
  it('is true when at least one license is verified', () => {
    expect(hasVerifiedBarLicense([publicLicense])).toBe(true);
  });

  it('is false when every license is still pending or rejected', () => {
    expect(
      hasVerifiedBarLicense([
        { ...publicLicense, status: LICENSE_STATUS.PENDING },
        { ...publicLicense, id: 'lic-2', status: LICENSE_STATUS.REJECTED },
      ]),
    ).toBe(false);
  });

  it('is false for an empty list', () => {
    expect(hasVerifiedBarLicense([])).toBe(false);
  });
});

describe('useAdminLicenses', () => {
  it('encodes the status filter into the admin queue request', async () => {
    const response: AdminLicensesResponse = {
      licenses: [],
      pagination: { page: 1, page_size: 20, total: 0 },
    };
    vi.mocked(api.get).mockResolvedValueOnce(response);

    const { result } = renderHook(() => useAdminLicenses(ADMIN_LICENSE_FILTER.PENDING), {
      wrapper: wrap(client),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/admin/licenses?status=pending');
  });

  it('supports the "all" filter', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      licenses: [],
      pagination: { page: 1, page_size: 20, total: 0 },
    });

    const { result } = renderHook(() => useAdminLicenses(ADMIN_LICENSE_FILTER.ALL), {
      wrapper: wrap(client),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/admin/licenses?status=all');
  });
});

describe('useReviewLicense', () => {
  it('verifies a license and invalidates the admin queue', async () => {
    vi.mocked(api.put).mockResolvedValueOnce({});
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useReviewLicense(), { wrapper: wrap(client) });
    result.current.mutate({ id: 'lic-1', status: LICENSE_STATUS.VERIFIED });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.put)).toHaveBeenCalledWith('/api/v1/admin/licenses/lic-1', {
      status: LICENSE_STATUS.VERIFIED,
    });
    expect(toastSuccess).toHaveBeenCalledWith('License verified');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['adminLicenses'] });
  });

  it('reports the rejection wording when rejecting', async () => {
    vi.mocked(api.put).mockResolvedValueOnce({});

    const { result } = renderHook(() => useReviewLicense(), { wrapper: wrap(client) });
    result.current.mutate({ id: 'lic-1', status: LICENSE_STATUS.REJECTED });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(toastSuccess).toHaveBeenCalledWith('License rejected');
  });

  it('surfaces the gateway’s reason on failure', async () => {
    vi.mocked(api.put).mockRejectedValueOnce(new ApiError(403, '{"error":"admin only"}'));

    const { result } = renderHook(() => useReviewLicense(), { wrapper: wrap(client) });
    result.current.mutate({ id: 'lic-1', status: LICENSE_STATUS.VERIFIED });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(toastError).toHaveBeenCalledWith('admin only');
  });

  it('falls back to a generic message for a non-ApiError failure', async () => {
    vi.mocked(api.put).mockRejectedValueOnce(new Error('offline'));

    const { result } = renderHook(() => useReviewLicense(), { wrapper: wrap(client) });
    result.current.mutate({ id: 'lic-1', status: LICENSE_STATUS.VERIFIED });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(toastError).toHaveBeenCalledWith('Could not update license');
  });
});
