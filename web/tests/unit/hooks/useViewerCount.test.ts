import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useViewerCount } from '@/hooks/useViewerCount';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    getPublic: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    code = 'ERR';
    userMessage(fallback: string) {
      return this.message || fallback;
    }
  },
}));

vi.mock('@/lib/auth', () => ({
  getAccessToken: vi.fn(),
}));

const { api } = await import('@/lib/api');
const { getAccessToken } = await import('@/lib/auth');

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useViewerCount', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('pings the viewer endpoint on mount and fetches the count', async () => {
    // The ping is auth-gated: only a logged-in viewer marks itself present.
    vi.mocked(getAccessToken).mockReturnValue('tok');
    vi.mocked(api.post).mockResolvedValue({});
    vi.mocked(api.getPublic).mockResolvedValueOnce({ count: 7 });

    const { result } = renderHook(() => useViewerCount('job-1'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => { expect(result.current.count).toBe(7); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/jobs/job-1/ping-viewer');
    expect(vi.mocked(api.getPublic)).toHaveBeenCalledWith(
      '/api/v1/jobs/job-1/viewer-count',
    );
  });

  it('returns 0 before the query resolves', () => {
    vi.mocked(api.post).mockResolvedValue({});
    // Never resolve — check pre-resolution state.
    vi.mocked(api.getPublic).mockReturnValue(new Promise(() => undefined));

    const { result } = renderHook(() => useViewerCount('job-1'), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.count).toBe(0);
  });

  it('swallows ping errors silently (auth-failure tolerant)', async () => {
    vi.mocked(getAccessToken).mockReturnValue('tok');
    vi.mocked(api.post).mockRejectedValue(new Error('401 unauthorized'));
    vi.mocked(api.getPublic).mockResolvedValueOnce({ count: 3 });

    const { result } = renderHook(() => useViewerCount('job-1'), {
      wrapper: createWrapper(queryClient),
    });

    // Hook still returns the public count even if the ping fails.
    await waitFor(() => { expect(result.current.count).toBe(3); });
  });

  it('skips the ping when logged out but still fetches the public count', async () => {
    // No token: the ping would route through the authed path whose 401 handler
    // redirects to /login, so a logged-out spectator must NOT ping.
    vi.mocked(getAccessToken).mockReturnValue(null);
    vi.mocked(api.getPublic).mockResolvedValueOnce({ count: 5 });

    const { result } = renderHook(() => useViewerCount('job-1'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => { expect(result.current.count).toBe(5); });
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
    expect(vi.mocked(api.getPublic)).toHaveBeenCalledWith('/api/v1/jobs/job-1/viewer-count');
  });

  it('does not ping or fetch when jobId is empty', () => {
    const { result } = renderHook(() => useViewerCount(''), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.count).toBe(0);
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
    // useQuery is disabled — no fetch either.
    expect(vi.mocked(api.getPublic)).not.toHaveBeenCalled();
  });
});
