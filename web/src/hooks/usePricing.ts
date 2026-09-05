import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export interface PricingData {
  category_name: string;
  category_slug: string;
  zip_code: string;
  completed_jobs: number;
  avg_price_cents: number;
  p25_price_cents: number;
  median_price_cents: number;
  p75_price_cents: number;
  min_price_cents: number;
  max_price_cents: number;
  avg_savings_cents: number | null;
  refreshed_at: string;
}

export interface PricingOverviewCategory {
  category_name: string;
  category_slug: string;
  total_jobs: number;
  avg_median_cents: number;
  avg_savings_cents: number | null;
}

export interface UsePricingOverviewOptions {
  /** When false, skip the network request (e.g. parent already seeded items). */
  enabled?: boolean;
  /** Server-seeded snapshot — first paint uses this instead of a loading skeleton. */
  initialData?: { categories: PricingOverviewCategory[] };
}

export function usePricingOverview(options: UsePricingOverviewOptions = {}) {
  const { enabled = true, initialData } = options;
  return useQuery<{ categories: PricingOverviewCategory[] }>({
    queryKey: ['pricing', 'overview'],
    queryFn: () => api.getPublic<{ categories: PricingOverviewCategory[] }>('/api/v1/pricing'),
    staleTime: 5 * 60 * 1000,
    enabled,
    ...(initialData !== undefined ? { initialData } : {}),
  });
}

export function usePricingByCategory(slug: string, zip?: string) {
  const path = `/api/v1/pricing/${slug}${zip ? `?zip=${encodeURIComponent(zip)}` : ''}`;

  return useQuery<{ prices: PricingData[] }>({
    queryKey: ['pricing', slug, zip],
    queryFn: () => api.getPublic<{ prices: PricingData[] }>(path),
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
  });
}

export interface PricingHeatmapPoint {
  zip_code: string;
  lat: number;
  lng: number;
  median_price_cents: number;
  completed_jobs: number;
}

export function usePricingHeatmap(categorySlug?: string) {
  const path = categorySlug
    ? `/api/v1/pricing/heatmap?category=${encodeURIComponent(categorySlug)}`
    : '/api/v1/pricing/heatmap';

  return useQuery<{ points: PricingHeatmapPoint[] }>({
    queryKey: ['pricing', 'heatmap', categorySlug ?? ''],
    queryFn: () => api.getPublic<{ points: PricingHeatmapPoint[] }>(path),
    staleTime: 5 * 60 * 1000,
  });
}
