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
}));

vi.mock('@/lib/auth', () => ({
  getAccessToken: vi.fn(() => 'test-token'),
}));

vi.mock('@/lib/constants', () => ({
  API_BASE_URL: 'http://test.local',
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

    const { result } = renderHook(() => useUploadCompletionPhoto('c-1'), { wrapper: wrap(client) });
    result.current.mutate({ file, phase: 'before' });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(callArgs[0]).toBe('http://test.local/api/v1/contracts/c-1/completion-photos');
    expect(callArgs[1].method).toBe('POST');
    expect((callArgs[1].headers as Record<string, string>)['Authorization']).toBe('Bearer test-token');
    expect(result.current.data?.url).toBe('https://cdn/img.jpg');
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
    expect(result.current.error?.message).toContain('payload too big');
  });
});
