// useCategories — the goods subtree selector (`useGoodsCategoryTree`), which
// useCategories.test.ts does not exercise: loading, root present, root
// missing, and a root with no children.
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCategories, useGoodsCategoryTree } from '@/hooks/useCategories';

import { type QueryHarness, createQueryHarness } from './_gaps-query-harness';

const mocks = vi.hoisted(() => ({
  get: vi.fn<(path: string) => Promise<unknown>>(),
}));

vi.mock('@/lib/api', () => ({
  api: { get: mocks.get },
}));

let h: QueryHarness;

beforeEach(() => {
  mocks.get.mockReset();
  h = createQueryHarness();
});

afterEach(() => {
  h.queryClient.clear();
});

describe('useGoodsCategoryTree', () => {
  it('is undefined (not an empty list) while the tree is loading', () => {
    mocks.get.mockReturnValue(new Promise(() => undefined));

    const { result } = renderHook(() => useGoodsCategoryTree(), { wrapper: h.wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(mocks.get).toHaveBeenCalledWith('/api/v1/categories/tree');
  });

  it('returns the children of the root whose slug is "goods"', async () => {
    const goodsChildren = [
      { id: 'g-1', slug: 'electronics', name: 'Electronics' },
      { id: 'g-2', slug: 'furniture', name: 'Furniture' },
    ];
    mocks.get.mockResolvedValue({
      categories: [
        { id: 's-1', slug: 'plumbing', name: 'Plumbing', children: [{ id: 's-2', slug: 'drains' }] },
        { id: 'g-0', slug: 'goods', name: 'Goods', children: goodsChildren },
      ],
    });

    const { result } = renderHook(() => useGoodsCategoryTree(), { wrapper: h.wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual(goodsChildren);
  });

  it('returns an empty list when the loaded tree has no goods root', async () => {
    mocks.get.mockResolvedValue({ categories: [{ id: 's-1', slug: 'plumbing', name: 'Plumbing' }] });

    const { result } = renderHook(() => useGoodsCategoryTree(), { wrapper: h.wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual([]);
  });

  it('returns an empty list when the goods root has no children field', async () => {
    mocks.get.mockResolvedValue({ categories: [{ id: 'g-0', slug: 'goods', name: 'Goods' }] });

    const { result } = renderHook(() => useGoodsCategoryTree(), { wrapper: h.wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual([]);
  });

  it('stays undefined and reports the error when the tree request fails', async () => {
    mocks.get.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useGoodsCategoryTree(), { wrapper: h.wrapper });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.data).toBeUndefined();
  });

  it('shares the ["categoryTree"] cache entry with useCategoryTree (one request)', async () => {
    mocks.get.mockResolvedValue({ categories: [] });

    const { result } = renderHook(
      () => ({ a: useGoodsCategoryTree(), b: useGoodsCategoryTree() }),
      { wrapper: h.wrapper },
    );

    await waitFor(() => {
      expect(result.current.b.isSuccess).toBe(true);
    });
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(h.queryClient.getQueryData(['categoryTree'])).toEqual([]);
  });
});

describe('useCategories — level 0', () => {
  it('still sends level=0 (a falsy but defined level is a real filter)', async () => {
    mocks.get.mockResolvedValue({ categories: [] });

    const { result } = renderHook(() => useCategories(0, ''), { wrapper: h.wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(mocks.get).toHaveBeenCalledWith('/api/v1/categories?level=0');
    expect(h.queryClient.getQueryData(['categories', 0, ''])).toEqual([]);
  });
});
