import { useQuery } from '@tanstack/react-query';

import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import type {
  AnalyticsMarketRange,
  CustomerSpendingResponse,
  ProviderAnalytics,
  ProviderEarningsResponse,
} from '@/types';

export function useMarketRange(
  categoryId: string,
  subcategoryId?: string,
  serviceTypeId?: string,
) {
  const searchParams = new URLSearchParams();
  searchParams.set('category_id', categoryId);
  if (subcategoryId) searchParams.set('subcategory_id', subcategoryId);
  if (serviceTypeId) searchParams.set('service_type_id', serviceTypeId);
  const query = searchParams.toString();
  const path = `/api/v1/analytics/market/range?${query}`;

  return useQuery({
    queryKey: ['market-range', categoryId, subcategoryId, serviceTypeId],
    queryFn: () => api.get<AnalyticsMarketRange>(path),
    enabled: !!categoryId,
  });
}

export function useProviderAnalytics(startDate?: string, endDate?: string) {
  const userId = useAuthStore((s) => s.user?.id);
  const searchParams = new URLSearchParams();
  if (startDate) searchParams.set('start_date', startDate);
  if (endDate) searchParams.set('end_date', endDate);
  const query = searchParams.toString();
  const path = `/api/v1/analytics/providers/${userId ?? 'me'}${query ? `?${query}` : ''}`;

  return useQuery({
    queryKey: ['provider-analytics', userId, startDate, endDate],
    enabled: !!userId,
    queryFn: async () => {
      try {
        return await api.get<ProviderAnalytics>(path);
      } catch (error) {
        if (error instanceof ApiError && (error.status === 404 || error.status === 500)) return null;
        throw error;
      }
    },
    retry: false,
  });
}

export function useProviderEarnings(
  startDate?: string,
  endDate?: string,
  groupBy?: string,
) {
  const searchParams = new URLSearchParams();
  if (startDate) searchParams.set('start_date', startDate);
  if (endDate) searchParams.set('end_date', endDate);
  if (groupBy) searchParams.set('group_by', groupBy);
  const query = searchParams.toString();
  const userId = useAuthStore((s) => s.user?.id);
  const path = `/api/v1/analytics/providers/${userId ?? 'me'}/earnings${query ? `?${query}` : ''}`;

  return useQuery({
    queryKey: ['provider-earnings', userId, startDate, endDate, groupBy],
    enabled: !!userId,
    queryFn: async () => {
      try {
        return await api.get<ProviderEarningsResponse>(path);
      } catch (error) {
        if (error instanceof ApiError && (error.status === 404 || error.status === 500)) return null;
        throw error;
      }
    },
    retry: false,
  });
}

export function useCustomerSpending(
  startDate?: string,
  endDate?: string,
  groupBy?: string,
) {
  const searchParams = new URLSearchParams();
  if (startDate) searchParams.set('start_date', startDate);
  if (endDate) searchParams.set('end_date', endDate);
  if (groupBy) searchParams.set('group_by', groupBy);
  const query = searchParams.toString();
  const path = `/api/v1/analytics/customers/me/spending${query ? `?${query}` : ''}`;

  return useQuery({
    queryKey: ['customer-spending', startDate, endDate, groupBy],
    queryFn: async () => {
      try {
        return await api.get<CustomerSpendingResponse>(path);
      } catch (error) {
        if (error instanceof ApiError && (error.status === 404 || error.status === 500)) return null;
        throw error;
      }
    },
    retry: false,
  });
}
