import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useFollow,
  useFollowers,
  useMyFeed,
  useMyFollows,
} from '@/hooks/useFollows';

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
    post: vi.fn(),
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
    post: ReturnType<typeof vi.fn>;
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

describe('useFollows hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toastSuccess.mockClear();
    toastError.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('useFollow', () => {
    it('POSTs to the follow endpoint when following=true', async () => {
      api.post.mockResolvedValue({ following: true, follower_count: 7 });
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useFollow('seller-1'), {
        wrapper: createWrapper(qc),
      });
      result.current.mutate({ following: true });
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(api.post).toHaveBeenCalledWith('/api/v1/users/seller-1/follow');
      expect(toastSuccess).toHaveBeenCalled();
    });

    it('DELETEs from the follow endpoint when following=false', async () => {
      api.delete.mockResolvedValue({ following: false });
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useFollow('seller-1'), {
        wrapper: createWrapper(qc),
      });
      result.current.mutate({ following: false });
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(api.delete).toHaveBeenCalledWith('/api/v1/users/seller-1/follow');
      expect(toastSuccess).toHaveBeenCalledWith('Unfollowed');
    });

    it('shows the ApiError message on failure', async () => {
      api.post.mockRejectedValue(new ApiError('Cannot follow yourself'));
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useFollow('seller-1'), {
        wrapper: createWrapper(qc),
      });
      result.current.mutate({ following: true });
      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
      expect(toastError).toHaveBeenCalledWith('Cannot follow yourself');
    });
  });

  describe('useFollowers', () => {
    it('fetches the public followers list', async () => {
      api.get.mockResolvedValue({ followers: [], pagination: {} });
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useFollowers('seller-1'), {
        wrapper: createWrapper(qc),
      });
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(api.get).toHaveBeenCalledWith('/api/v1/users/seller-1/followers');
    });

    it('threads the page param through the URL', async () => {
      api.get.mockResolvedValue({ followers: [], pagination: {} });
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useFollowers('seller-1', 3), {
        wrapper: createWrapper(qc),
      });
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(api.get).toHaveBeenCalledWith('/api/v1/users/seller-1/followers?page=3');
    });
  });

  describe('useMyFollows', () => {
    it('fetches /api/v1/me/follows', async () => {
      api.get.mockResolvedValue({ follows: [], pagination: {} });
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useMyFollows(), { wrapper: createWrapper(qc) });
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(api.get).toHaveBeenCalledWith('/api/v1/me/follows');
    });
  });

  describe('useMyFeed', () => {
    it('fetches /api/v1/me/feed', async () => {
      api.get.mockResolvedValue({ listings: [], pagination: {} });
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useMyFeed(), { wrapper: createWrapper(qc) });
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(api.get).toHaveBeenCalledWith('/api/v1/me/feed');
    });

    it('threads the page param through the URL', async () => {
      api.get.mockResolvedValue({ listings: [], pagination: {} });
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useMyFeed(2), { wrapper: createWrapper(qc) });
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(api.get).toHaveBeenCalledWith('/api/v1/me/feed?page=2');
    });
  });
});
