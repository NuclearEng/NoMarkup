// useProviderProfile — branches useProviderProfile.test.ts leaves untested:
// the 404 detection for a non-ApiError rejection, the one-retry policy, the
// resubmission-lockout copy for every 422 / non-422 shape, the document index
// (aliases, blank types, missing counts, tie-breaking), the null documents
// envelope, and the availability cache merge when the PUT echo has no schedule.
//
// The real ApiError is kept so `instanceof` + userMessage() parsing are genuine.
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  indexDocumentsByType,
  isDocumentResubmissionLocked,
  normalizeDocumentTypeKey,
  resubmissionLockoutMessage,
  useProviderProfile,
  useProviderVerificationDocuments,
  useSetAvailability,
  useUploadVerificationDocument,
} from '@/hooks/useProviderProfile';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
    },
  };
});

const { api, ApiError } = await import('@/lib/api');

const LOCKOUT_COPY =
  'This document type has no re-uploads left (maximum 3). Contact support to continue verification.';

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // retryDelay 0 so the hook's own single retry does not wait a second.
      queries: { retryDelay: 0, gcTime: Infinity },
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
  vi.resetAllMocks();
  queryClient = createTestQueryClient();
});

afterEach(() => {
  queryClient.clear();
});

describe('useProviderProfile missing-profile + retry policy', () => {
  it('treats a real ApiError 404 as "no profile yet" with a single request', async () => {
    vi.mocked(api.get).mockRejectedValue(new ApiError(404, 'not found'));

    const { result } = renderHook(() => useProviderProfile(), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toBeNull();
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(['providerProfile'])).toBeNull();
  });

  it('reads the status off a non-ApiError rejection as well', async () => {
    vi.mocked(api.get).mockRejectedValue({ status: 404 });

    const { result } = renderHook(() => useProviderProfile(), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toBeNull();
  });

  it('retries a server error exactly once before surfacing it', async () => {
    const failure = new ApiError(503, 'unavailable');
    vi.mocked(api.get).mockRejectedValue(failure);

    const { result } = renderHook(() => useProviderProfile(), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBe(failure);
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(2);
  });

  it('recovers when the single retry succeeds', async () => {
    vi.mocked(api.get)
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce({ id: 'prof-1', business_name: 'Acme' });

    const { result } = renderHook(() => useProviderProfile(), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual({ id: 'prof-1', business_name: 'Acme' });
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(2);
  });
});

describe('resubmissionLockoutMessage', () => {
  interface MessageCase {
    name: string;
    err: unknown;
    fallback?: string;
    expected: string;
  }

  const CASES: MessageCase[] = [
    {
      name: '422 mentioning "maximum" maps to the lockout copy',
      err: new ApiError(422, JSON.stringify({ error: 'Maximum attempts reached' })),
      fallback: 'Upload failed',
      expected: LOCKOUT_COPY,
    },
    {
      name: '422 with an unrelated server reason shows that reason',
      err: new ApiError(422, JSON.stringify({ error: 'file is not a PDF' })),
      fallback: 'Upload failed',
      expected: 'file is not a PDF',
    },
    {
      name: '422 with an empty body uses the caller fallback',
      err: new ApiError(422, ''),
      fallback: 'Upload failed',
      expected: 'Upload failed',
    },
    {
      name: '422 with an empty body and no fallback uses the lockout copy',
      err: new ApiError(422, ''),
      expected: LOCKOUT_COPY,
    },
    {
      name: 'a non-422 ApiError ignores the server text and uses the fallback',
      err: new ApiError(500, JSON.stringify({ error: 'contact support' })),
      fallback: 'Upload failed',
      expected: 'Upload failed',
    },
    {
      name: 'a non-ApiError with no fallback uses the lockout copy',
      err: new Error('boom'),
      expected: LOCKOUT_COPY,
    },
  ];

  it.each(CASES)('$name', ({ err, fallback, expected }) => {
    expect(resubmissionLockoutMessage(err, fallback)).toBe(expected);
  });
});

describe('document helpers', () => {
  it.each([
    ['government_id', 'drivers_license'],
    ['driver_license', 'drivers_license'],
    ['  id  ', 'drivers_license'],
    ['proof_of_insurance', 'insurance'],
    [' business_license ', 'business_license'],
  ])('normalizeDocumentTypeKey(%j) → %j', (input, expected) => {
    expect(normalizeDocumentTypeKey(input)).toBe(expected);
  });

  it('isDocumentResubmissionLocked treats null as zero attempts', () => {
    expect(isDocumentResubmissionLocked(null)).toBe(false);
  });

  it('indexDocumentsByType returns an empty index for undefined', () => {
    expect(indexDocumentsByType(undefined)).toEqual({});
  });

  it('skips rows whose document_type is blank', () => {
    const map = indexDocumentsByType([
      { document_type: '   ', status: 'pending' },
      { document_type: 'insurance', status: 'approved' },
    ]);

    expect(Object.keys(map)).toEqual(['insurance']);
  });

  it('keeps the earlier row when a later duplicate has fewer resubmissions', () => {
    const map = indexDocumentsByType([
      { id: 'newer', document_type: 'insurance', status: 'rejected', resubmission_count: 2 },
      { id: 'older', document_type: 'proof_of_insurance', status: 'rejected' },
    ]);

    expect(map.insurance?.id).toBe('newer');
  });

  it('lets the later row win a tie, counting a missing count as zero on both sides', () => {
    const map = indexDocumentsByType([
      { id: 'first', document_type: 'insurance', status: 'pending' },
      { id: 'second', document_type: 'insurance', status: 'approved' },
    ]);

    expect(map.insurance?.id).toBe('second');
  });
});

describe('useProviderVerificationDocuments', () => {
  it.each([{ documents: null }, {}])('resolves to [] when the gateway sends %j', async (body) => {
    vi.mocked(api.get).mockResolvedValueOnce(body);

    const { result } = renderHook(() => useProviderVerificationDocuments(), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([]);
    expect(queryClient.getQueryData(['providerVerificationDocuments'])).toEqual([]);
  });
});

describe('useUploadVerificationDocument', () => {
  const input = {
    document_type: 'insurance',
    file_url: 'https://cdn.example/doc.pdf',
    file_name: 'doc.pdf',
    mime_type: 'application/pdf',
    size_bytes: 1234,
  };

  it('refreshes both the profile and the documents list', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ document_id: 'd-1', status: 'pending' });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useUploadVerificationDocument(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate(input);
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/providers/me/documents', input);
    expect(invalidateSpy.mock.calls.map(([f]) => f?.queryKey)).toEqual([
      ['providerProfile'],
      ['providerVerificationDocuments'],
    ]);
  });

  it('refreshes nothing when the upload is rejected', async () => {
    const lockout = new ApiError(422, JSON.stringify({ error: 'resubmission limit' }));
    vi.mocked(api.post).mockRejectedValueOnce(lockout);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useUploadVerificationDocument(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate(input);
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(resubmissionLockoutMessage(result.current.error)).toBe(LOCKOUT_COPY);
  });
});

describe('useSetAvailability cache merge', () => {
  function neverSettlingRefetch(): void {
    // Block the invalidate-driven refetch from overwriting the merge under test.
    vi.mocked(api.get).mockReturnValue(new Promise(() => undefined));
  }

  interface CachedProfile {
    instant_enabled: boolean;
    instant_available: boolean;
    schedule?: { day: string }[];
  }

  it('sends an empty schedule when the caller omits it', async () => {
    vi.mocked(api.put).mockResolvedValueOnce({ instant_enabled: false, instant_available: false });

    const { result } = renderHook(() => useSetAvailability(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({ enabled: false, available_now: false });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.put)).toHaveBeenCalledWith('/api/v1/providers/me/availability', {
      enabled: false,
      available_now: false,
      schedule: [],
    });
  });

  it('leaves a missing profile cache empty rather than fabricating a profile', async () => {
    neverSettlingRefetch();
    vi.mocked(api.put).mockResolvedValueOnce({ instant_enabled: true, instant_available: true });

    const { result } = renderHook(() => useSetAvailability(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({ enabled: true, available_now: true });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(queryClient.getQueryData(['providerProfile'])).toBeUndefined();
  });

  it('keeps a cached null profile as null', async () => {
    neverSettlingRefetch();
    queryClient.setQueryData(['providerProfile'], null);
    vi.mocked(api.put).mockResolvedValueOnce({ instant_enabled: true, instant_available: true });

    const { result } = renderHook(() => useSetAvailability(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({ enabled: true, available_now: true });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(queryClient.getQueryData(['providerProfile'])).toBeNull();
  });

  it('keeps the cached windows when the PUT echo carries no schedule', async () => {
    neverSettlingRefetch();
    queryClient.setQueryData(['providerProfile'], {
      id: 'prof-1',
      instant_enabled: false,
      instant_available: false,
      schedule: [{ day: 'wed', start_time: '09:00', end_time: '12:00' }],
    });
    vi.mocked(api.put).mockResolvedValueOnce({ instant_enabled: true, instant_available: false });

    const { result } = renderHook(() => useSetAvailability(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({ enabled: true, available_now: false });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const cached = queryClient.getQueryData<CachedProfile>(['providerProfile']);
    expect(cached?.instant_enabled).toBe(true);
    expect(cached?.instant_available).toBe(false);
    expect(cached?.schedule).toEqual([{ day: 'wed', start_time: '09:00', end_time: '12:00' }]);
  });

  it('falls back to an empty schedule when neither the echo nor the cache has one', async () => {
    neverSettlingRefetch();
    queryClient.setQueryData(['providerProfile'], {
      id: 'prof-1',
      instant_enabled: false,
      instant_available: false,
    });
    vi.mocked(api.put).mockResolvedValueOnce({ instant_enabled: true, instant_available: true });

    const { result } = renderHook(() => useSetAvailability(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({ enabled: true, available_now: true });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(queryClient.getQueryData<CachedProfile>(['providerProfile'])?.schedule).toEqual([]);
  });

  it('an explicit empty echo clears previously cached windows', async () => {
    neverSettlingRefetch();
    queryClient.setQueryData(['providerProfile'], {
      id: 'prof-1',
      instant_enabled: true,
      instant_available: true,
      schedule: [{ day: 'wed', start_time: '09:00', end_time: '12:00' }],
    });
    vi.mocked(api.put).mockResolvedValueOnce({
      instant_enabled: false,
      instant_available: false,
      schedule: [],
    });

    const { result } = renderHook(() => useSetAvailability(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({ enabled: false, available_now: false, schedule: [] });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(queryClient.getQueryData<CachedProfile>(['providerProfile'])?.schedule).toEqual([]);
  });
});
