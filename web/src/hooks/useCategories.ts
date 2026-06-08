import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { ServiceCategory } from '@/types';

export function useCategories(level?: number, parentId?: string) {
  const params = new URLSearchParams();
  if (level !== undefined) params.set('level', String(level));
  if (parentId) params.set('parent_id', parentId);
  const query = params.toString();
  const path = `/api/v1/categories${query ? `?${query}` : ''}`;

  return useQuery({
    queryKey: ['categories', level, parentId],
    queryFn: () =>
      api
        .get<{ categories: ServiceCategory[] }>(path)
        .then((res) => res.categories),
    staleTime: Infinity,
  });
}

export function useCategoryTree() {
  return useQuery({
    queryKey: ['categoryTree'],
    queryFn: () =>
      api
        .get<{ categories: ServiceCategory[] }>('/api/v1/categories/tree')
        .then((res) => res.categories),
    staleTime: Infinity,
  });
}

/**
 * useGoodsCategoryTree returns the GOODS subtree (children of the level-1 'goods'
 * root) from the same /categories/tree endpoint. This makes the DB the single
 * source of truth for goods categories and kills the old hardcoded TS arrays
 * (which had drifted out of sync — ListingFilters vs ListingPostingForm).
 *
 * The shape mirrors useCategoryTree: an array of ServiceCategory with nested
 * `children`, so the existing drill-down picker pattern works unchanged. We
 * match the root by slug ('goods') rather than is_goods because the public tree
 * JSON does not expose the is_goods flag.
 */
export function useGoodsCategoryTree() {
  const query = useCategoryTree();
  const goodsRoot = query.data?.find((c) => c.slug === 'goods');
  return {
    ...query,
    // Children of the goods root = the level-2 goods categories. Undefined while
    // loading; empty array if the root somehow isn't present.
    data: goodsRoot?.children ?? (query.data ? [] : undefined),
  };
}
