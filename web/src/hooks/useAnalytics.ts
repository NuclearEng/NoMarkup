import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
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
  const path = `/api/v1/analytics/market-range?${query}`;

  return useQuery({
    queryKey: ['market-range', categoryId, subcategoryId, serviceTypeId],
    queryFn: () => api.get<AnalyticsMarketRange>(path),
    enabled: !!categoryId,
  });
}

export function useProviderAnalytics(startDate?: string, endDate?: string) {
  const searchParams = new URLSearchParams();
  if (startDate) searchParams.set('start_date', startDate);
  if (endDate) searchParams.set('end_date', endDate);
  const query = searchParams.toString();
  const path = `/api/v1/analytics/provider${query ? `?${query}` : ''}`;

  return useQuery({
    queryKey: ['provider-analytics', startDate, endDate],
    queryFn: () => api.get<ProviderAnalytics>(path),
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
  const path = `/api/v1/analytics/provider/earnings${query ? `?${query}` : ''}`;

  return useQuery({
    queryKey: ['provider-earnings', startDate, endDate, groupBy],
    queryFn: () => api.get<ProviderEarningsResponse>(path),
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
  const path = `/api/v1/analytics/customer/spending${query ? `?${query}` : ''}`;

  return useQuery({
    queryKey: ['customer-spending', startDate, endDate, groupBy],
    queryFn: () => api.get<CustomerSpendingResponse>(path),
  });
}
