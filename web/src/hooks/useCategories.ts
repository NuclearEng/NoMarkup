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
