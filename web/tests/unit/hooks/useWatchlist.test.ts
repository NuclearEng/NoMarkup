import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useCreateSavedSearch,
  useDeleteSavedSearch,
  useSavedSearches,
  useWatchListing,
  useWatchlist,
} from '@/hooks/useWatchlist';

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

describe('useWatchlist hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toastSuccess.mockClear();
    toastError.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('useWatchListing', () => {
    it('POSTs to the watch endpoint when watching=true', async () => {
      api.post.mockResolvedValue({ watching: true, watcher_count: 5 });
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useWatchListing('listing-1'), {
        wrapper: createWrapper(qc),
      });
      result.current.mutate({ watching: true });
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(api.post).toHaveBeenCalledWith('/api/v1/listings/listing-1/watch');
      expect(toastSuccess).toHaveBeenCalledWith('Added to watchlist');
    });

    it('DELETEs from the watch endpoint when watching=false', async () => {
      api.delete.mockResolvedValue({ watching: false });
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useWatchListing('listing-1'), {
        wrapper: createWrapper(qc),
      });
      result.current.mutate({ watching: false });
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(api.delete).toHaveBeenCalledWith('/api/v1/listings/listing-1/watch');
      expect(toastSuccess).toHaveBeenCalledWith('Removed from watchlist');
    });

    it('shows the ApiError message on failure', async () => {
      api.post.mockRejectedValue(new ApiError('Already watching'));
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useWatchListing('listing-1'), {
        wrapper: createWrapper(qc),
      });
      result.current.mutate({ watching: true });
      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
      expect(toastError).toHaveBeenCalledWith('Already watching');
    });
  });

  describe('useWatchlist', () => {
    it('fetches /api/v1/me/watchlist', async () => {
      api.get.mockResolvedValue({ listings: [], pagination: {} });
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useWatchlist(), { wrapper: createWrapper(qc) });
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(api.get).toHaveBeenCalledWith('/api/v1/me/watchlist');
    });

    it('threads the page param through the URL', async () => {
      api.get.mockResolvedValue({ listings: [], pagination: {} });
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useWatchlist(2), { wrapper: createWrapper(qc) });
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(api.get).toHaveBeenCalledWith('/api/v1/me/watchlist?page=2');
    });
  });

  describe('useSavedSearches', () => {
    it('fetches the saved-searches list', async () => {
      api.get.mockResolvedValue({ saved_searches: [] });
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useSavedSearches(), { wrapper: createWrapper(qc) });
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(api.get).toHaveBeenCalledWith('/api/v1/me/saved-searches');
    });
  });

  describe('useCreateSavedSearch', () => {
    it('POSTs the saved search with default frequency=daily', async () => {
      api.post.mockResolvedValue({
        saved_search: {
          id: 's-1',
          user_id: 'u-1',
          name: 'Sneakers',
          query: {},
          alert_frequency: 'daily',
          last_run_at: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      });
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useCreateSavedSearch(), { wrapper: createWrapper(qc) });
      result.current.mutate({ name: 'Sneakers', query: { query: 'jordan' } });
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(api.post).toHaveBeenCalledWith('/api/v1/me/saved-searches', {
        name: 'Sneakers',
        query: { query: 'jordan' },
        alert_frequency: 'daily',
      });
      expect(toastSuccess).toHaveBeenCalled();
    });

    it('passes through an explicit alert_frequency', async () => {
      api.post.mockResolvedValue({ saved_search: {} });
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useCreateSavedSearch(), { wrapper: createWrapper(qc) });
      result.current.mutate({
        name: 'Tools',
        query: { category_id: 'c-1' },
        alert_frequency: 'instant',
      });
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(api.post).toHaveBeenCalledWith('/api/v1/me/saved-searches', {
        name: 'Tools',
        query: { category_id: 'c-1' },
        alert_frequency: 'instant',
      });
    });
  });

  describe('useDeleteSavedSearch', () => {
    it('DELETEs by id', async () => {
      api.delete.mockResolvedValue({});
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useDeleteSavedSearch(), { wrapper: createWrapper(qc) });
      result.current.mutate('s-42');
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(api.delete).toHaveBeenCalledWith('/api/v1/me/saved-searches/s-42');
      expect(toastSuccess).toHaveBeenCalledWith('Saved search removed');
    });
  });
});
