'use client';

// Wave 5 — power-seller analytics hook. Wraps the
// `GET /api/v1/me/seller-analytics?range=Xd` gateway endpoint and feeds
// the dashboard's daily-revenue chart, sell-through pill, and top-
// categories list.
//
// Range is one of '7d' | '30d' | '90d'. Defaults to '30d' (the gateway
// also defaults to 30 if the param is missing, but we mirror the default
// so the query key is stable across components).

import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { SellerAnalytics } from '@/types';

export type SellerAnalyticsRange = '7d' | '30d' | '90d';

export function useSellerAnalytics(range: SellerAnalyticsRange = '30d') {
  return useQuery<SellerAnalytics>({
    queryKey: ['seller-analytics', range],
    queryFn: () => api.get<SellerAnalytics>(`/api/v1/me/seller-analytics?range=${range}`),
    staleTime: 60_000,
  });
}
