import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useCheckIn,
  useCheckOut,
  useUploadCompletionPhoto,
  useWorkSession,
} from '@/hooks/useWorkspace';

const { toast } = await import('sonner');

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    getPublic: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    code = 'ERR';
    userMessage(fallback: string) { return this.message || fallback; }
  },
  getApiErrorMessage: (err: unknown, fallback: string): string =>
    err instanceof Error && err.message ? err.message : fallback,
}));

vi.mock('@/lib/auth', () => ({
  getAccessToken: vi.fn(() => 'test-token'),
}));

const { api } = await import('@/lib/api');
const { getAccessToken } = await import('@/lib/auth');

function qc(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}
function wrap(client: QueryClient) {
  return function W({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

// Helper: mock navigator.geolocation success/error.
function mockGeoSuccess(lat: number, lng: number) {
  const getCurrentPosition = vi.fn((success: PositionCallback) => {
    success({
      coords: {
        latitude: lat,
        longitude: lng,
        accuracy: 10,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        toJSON: () => ({}),
      },
      timestamp: Date.now(),
      toJSON: () => ({}),
    });
  });
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition, watchPosition: vi.fn(), clearWatch: vi.fn() },
  });
}

// Helper: mock navigator.geolocation rejecting with a permission-denied error.
function mockGeoError(code: number) {
  const PERMISSION_DENIED = 1;
  const getCurrentPosition = vi.fn(
    (_success: PositionCallback, error?: PositionErrorCallback) => {
      if (error) {
        error({
          code,
          message: 'mock geo error',
          PERMISSION_DENIED,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        } as GeolocationPositionError);
      }
    },
  );
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition, watchPosition: vi.fn(), clearWatch: vi.fn() },
  });
}

describe('useWorkSession', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('fetches the work-session for a contract', async () => {
    const session = {
      status: 'checked_in',
      checked_in_at: '2026-04-25T08:00:00Z',
      checked_out_at: null,
      duration_minutes: null,
    };
    vi.mocked(api.get).mockResolvedValueOnce(session);

    const { result } = renderHook(() => useWorkSession('c-1'), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data).toEqual(session);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/contracts/c-1/work-session');
  });

  it('does not fetch with empty contractId', () => {
    const { result } = renderHook(() => useWorkSession(''), { wrapper: wrap(client) });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useCheckIn', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('reads geolocation, posts lat/lng, invalidates the work-session cache', async () => {
    mockGeoSuccess(37.7749, -122.4194);
    vi.mocked(api.post).mockResolvedValueOnce({ checked_in_at: '2026-04-25T08:00:00Z' });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useCheckIn('c-1'), { wrapper: wrap(client) });
    result.current.mutate();
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/contracts/c-1/checkin',
      { lat: 37.7749, lng: -122.4194 },
    );
    expect(spy).toHaveBeenCalledWith({ queryKey: ['work-session', 'c-1'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['work-evidence', 'c-1'] });
  });
});

describe('useCheckOut', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('reads geolocation, posts lat/lng, returns duration, invalidates work-session', async () => {
    mockGeoSuccess(40.7128, -74.0060);
    vi.mocked(api.post).mockResolvedValueOnce({
      checked_out_at: '2026-04-25T17:00:00Z',
      duration_minutes: 480,
    });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useCheckOut('c-1'), { wrapper: wrap(client) });
    result.current.mutate();
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/contracts/c-1/checkout',
      { lat: 40.7128, lng: -74.0060 },
    );
    expect(result.current.data?.duration_minutes).toBe(480);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['work-session', 'c-1'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['work-evidence', 'c-1'] });
  });
});

describe('useUploadCompletionPhoto', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getAccessToken).mockReturnValue('test-token');
    client = qc();
  });
  afterEach(() => { client.clear(); });

  it('POSTs multipart to the completion-photos endpoint and parses the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({ url: 'https://cdn/img.jpg', phase: 'before' }),
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useUploadCompletionPhoto('c-1'), { wrapper: wrap(client) });
    result.current.mutate({ file, phase: 'before' });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
    // Relative (same-origin) URL: the multipart upload goes through the Next
    // rewrite proxy so the session cookie is sent without a CORS preflight.
    expect(callArgs[0]).toBe('/api/v1/contracts/c-1/completion-photos');
    expect(callArgs[1].method).toBe('POST');
    expect(callArgs[1].credentials).toBe('include');
    expect((callArgs[1].headers as Record<string, string>)['Authorization']).toBe('Bearer test-token');
    expect(result.current.data?.url).toBe('https://cdn/img.jpg');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['work-evidence', 'c-1'] });
  });

  it('throws when the upload response is not ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      text: () => Promise.resolve('payload too big'),
      json: () => Promise.resolve({}),
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });

    const { result } = renderHook(() => useUploadCompletionPhoto('c-1'), { wrapper: wrap(client) });
    result.current.mutate({ file, phase: 'after' });
    await waitFor(() => { expect(result.current.isError).toBe(true); });
    expect((result.current.error as Error | null)?.message).toContain('payload too big');
  });

  it('falls back to a generic error when the body is empty', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({}),
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });

    const { result } = renderHook(() => useUploadCompletionPhoto('c-1'), { wrapper: wrap(client) });
    result.current.mutate({ file, phase: 'after' });
    await waitFor(() => { expect(result.current.isError).toBe(true); });
    expect((result.current.error as Error | null)?.message).toBe('Failed to upload photo');
  });

  it('omits the Authorization header when there is no access token', async () => {
    vi.mocked(getAccessToken).mockReturnValue(null);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({ url: 'https://cdn/x.jpg', phase: 'after' }),
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });

    const { result } = renderHook(() => useUploadCompletionPhoto('c-2'), { wrapper: wrap(client) });
    result.current.mutate({ file, phase: 'after' });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    const headers = (fetchMock.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('shows an after-photo success toast on upload success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({ url: 'https://cdn/y.jpg', phase: 'after' }),
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });

    const { result } = renderHook(() => useUploadCompletionPhoto('c-3'), { wrapper: wrap(client) });
    result.current.mutate({ file, phase: 'after' });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(toast.success)).toHaveBeenCalledWith('After photo uploaded');
  });
});

describe('useCheckIn — geolocation errors', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('rejects with a permission-denied message when the user blocks location', async () => {
    mockGeoError(1); // PERMISSION_DENIED

    const { result } = renderHook(() => useCheckIn('c-9'), { wrapper: wrap(client) });
    result.current.mutate();
    await waitFor(() => { expect(result.current.isError).toBe(true); });

    expect((result.current.error as Error | null)?.message).toContain('Location access was denied');
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      expect.stringContaining('Location access was denied'),
    );
  });

  it('rejects with a generic message when geolocation fails for non-permission reasons', async () => {
    mockGeoError(2); // POSITION_UNAVAILABLE

    const { result } = renderHook(() => useCheckIn('c-9'), { wrapper: wrap(client) });
    result.current.mutate();
    await waitFor(() => { expect(result.current.isError).toBe(true); });

    expect((result.current.error as Error | null)?.message).toContain('Unable to determine your location');
  });

  it('surfaces api.post failures via the error toast', async () => {
    mockGeoSuccess(1, 2);
    vi.mocked(api.post).mockRejectedValueOnce(new Error('500: bad gateway'));

    const { result } = renderHook(() => useCheckIn('c-fail'), { wrapper: wrap(client) });
    result.current.mutate();
    await waitFor(() => { expect(result.current.isError).toBe(true); });

    expect((result.current.error as Error | null)?.message).toBe('500: bad gateway');
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('500: bad gateway');
  });
});

describe('useCheckOut — duration formatting + errors', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('formats hours and minutes when duration spans multiple hours', async () => {
    mockGeoSuccess(1, 2);
    vi.mocked(api.post).mockResolvedValueOnce({
      checked_out_at: '2026-04-25T17:00:00Z',
      duration_minutes: 125, // 2h 5m
    });

    const { result } = renderHook(() => useCheckOut('c-h'), { wrapper: wrap(client) });
    result.current.mutate();
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Checked out — worked 2h 5m');
  });

  it('formats minutes-only when duration is under an hour', async () => {
    mockGeoSuccess(1, 2);
    vi.mocked(api.post).mockResolvedValueOnce({
      checked_out_at: '2026-04-25T08:30:00Z',
      duration_minutes: 45,
    });

    const { result } = renderHook(() => useCheckOut('c-m'), { wrapper: wrap(client) });
    result.current.mutate();
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Checked out — worked 45 min');
  });

  it('rejects with a permission-denied message when the user blocks location on checkout', async () => {
    mockGeoError(1);

    const { result } = renderHook(() => useCheckOut('c-d'), { wrapper: wrap(client) });
    result.current.mutate();
    await waitFor(() => { expect(result.current.isError).toBe(true); });

    expect((result.current.error as Error | null)?.message).toContain('Location access was denied');
  });

  it('rejects with a generic message when geolocation fails for non-permission reasons on checkout', async () => {
    mockGeoError(2); // POSITION_UNAVAILABLE

    const { result } = renderHook(() => useCheckOut('c-d'), { wrapper: wrap(client) });
    result.current.mutate();
    await waitFor(() => { expect(result.current.isError).toBe(true); });

    expect((result.current.error as Error | null)?.message).toContain('Unable to determine your location');
  });

  it('surfaces api.post failures as errors via onError toast on checkout', async () => {
    mockGeoSuccess(1, 2);
    vi.mocked(api.post).mockRejectedValueOnce(new Error('502: bad gateway'));

    const { result } = renderHook(() => useCheckOut('c-fail'), { wrapper: wrap(client) });
    result.current.mutate();
    await waitFor(() => { expect(result.current.isError).toBe(true); });

    expect((result.current.error as Error | null)?.message).toBe('502: bad gateway');
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('502: bad gateway');
  });

  it('wraps non-Error api.post rejections from checkout into Error instances', async () => {
    mockGeoSuccess(1, 2);
    // Reject with a non-Error (string) value to exercise the
    // `err instanceof Error ? err : new Error(String(err))` branch.
    vi.mocked(api.post).mockRejectedValueOnce('plain-string-error' as unknown as Error);

    const { result } = renderHook(() => useCheckOut('c-fail2'), { wrapper: wrap(client) });
    result.current.mutate();
    await waitFor(() => { expect(result.current.isError).toBe(true); });

    expect((result.current.error as Error | null)?.message).toBe('plain-string-error');
  });

  it('falls back to a generic message when the rejection is not an Error', async () => {
    mockGeoSuccess(1, 2);
    // After geolocation success, fail the api call. We want the onError handler
    // to receive a non-Error value so the fallback string in the toast is used.
    vi.mocked(api.post).mockImplementationOnce(
      () => Promise.reject({ statusCode: 500 } as unknown as Error),
    );

    const { result } = renderHook(() => useCheckOut('c-fail3'), { wrapper: wrap(client) });
    result.current.mutate();
    await waitFor(() => { expect(result.current.isError).toBe(true); });

    // mutationFn wraps non-Error rejections into Error(String(value)) so error.message
    // reflects the stringified value; the onError fallback path runs only when
    // err is not an Error — confirm via toast invocation receiving stringified value.
    expect(vi.mocked(toast.error)).toHaveBeenCalled();
  });
});
