import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCategories, useCategoryTree } from '@/hooks/useCategories';

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
    userMessage(fallback: string) {
      return this.message || fallback;
    }
  },
}));
const { api } = await import('@/lib/api');

function qc() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}
function wrap(client: QueryClient) {
  return function W({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

describe('useCategories', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    client = qc();
  });
  afterEach(() => {
    client.clear();
  });

  it('fetches /categories with no query string when no filters provided', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      categories: [{ id: 'cat-1', name: 'Plumbing' }],
    });

    const { result } = renderHook(() => useCategories(), { wrapper: wrap(client) });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/categories');
    expect(result.current.data).toHaveLength(1);
  });

  it('encodes the level param', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ categories: [] });

    const { result } = renderHook(() => useCategories(2), { wrapper: wrap(client) });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/categories?level=2');
  });

  it('encodes both level + parent_id', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ categories: [] });

    const { result } = renderHook(() => useCategories(3, 'parent-1'), { wrapper: wrap(client) });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/v1/categories?level=3&parent_id=parent-1',
    );
  });

  it('encodes parent_id alone (level omitted)', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ categories: [] });

    const { result } = renderHook(() => useCategories(undefined, 'parent-1'), {
      wrapper: wrap(client),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/categories?parent_id=parent-1');
  });
});

describe('useCategoryTree', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    client = qc();
  });
  afterEach(() => {
    client.clear();
  });

  it('fetches /categories/tree and unwraps the categories array', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      categories: [
        { id: 'cat-1', name: 'Plumbing' },
        { id: 'cat-2', name: 'Electrical' },
      ],
    });

    const { result } = renderHook(() => useCategoryTree(), { wrapper: wrap(client) });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/categories/tree');
    expect(result.current.data).toHaveLength(2);
  });
});
