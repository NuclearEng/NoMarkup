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

export function usePricingOverview() {
  return useQuery<{ categories: PricingOverviewCategory[] }>({
    queryKey: ['pricing', 'overview'],
    queryFn: () => api.getPublic<{ categories: PricingOverviewCategory[] }>('/api/v1/pricing'),
    staleTime: 5 * 60 * 1000,
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
