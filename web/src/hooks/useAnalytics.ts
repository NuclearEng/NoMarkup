import { useQuery } from '@tanstack/react-query';

import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import type {
  AnalyticsMarketRange,
  CustomerSpendingResponse,
  FairPrice,
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
    enabled: !!categoryId,
    retry: false,
    queryFn: async () => {
      try {
        // Public read: the FairPriceWidget renders on the public jobs browse +
        // job-detail surface, so logged-out visitors hit this. getPublic skips
        // the bearer + the 401 → clearTokens → redirect-to-/login interceptor
        // path that would otherwise bounce an anonymous visitor off a public
        // page. The gateway route is public (aggregate fair-price data, no PII).
        return await api.getPublic<AnalyticsMarketRange>(path);
      } catch (error) {
        // "No market range computed yet" is a normal empty state. The gateway
        // now returns 200 { has_data: false }, but stay tolerant of older
        // deployments that 404'd, so the widget never surfaces a console error
        // for a dataless category. A 401 from a pre-redeploy gateway (route was
        // auth-gated) is likewise treated as no-data so the public page renders.
        if (error instanceof ApiError && (error.status === 404 || error.status === 401)) {
          return { has_data: false } as AnalyticsMarketRange;
        }
        throw error;
      }
    },
  });
}

export interface UseFairPriceArgs {
  // Accept slug-or-id flexible inputs (CLAUDE.md §15) — the gateway resolves
  // either. Callers on the public pricing surface have a slug; the auction
  // arena has both an id and a slug.
  categoryId?: string;
  categorySlug?: string;
  zip?: string;
}

// Fair-Price engine read. Public aggregate (no PII), so it uses getPublic to
// skip the bearer + 401-bounce interceptor — logged-out visitors hit the
// pricing page. A 404/401 from an older/auth-gated gateway is normalized to the
// same has_data:false empty state the new gateway returns natively, so the band
// degrades to "Not enough local data yet" instead of surfacing an error.
export function useFairPrice({ categoryId, categorySlug, zip }: UseFairPriceArgs) {
  const category = categoryId ?? categorySlug ?? '';
  const searchParams = new URLSearchParams();
  if (categoryId) searchParams.set('category_id', categoryId);
  else if (categorySlug) searchParams.set('category_slug', categorySlug);
  if (zip) searchParams.set('zip', zip);
  const query = searchParams.toString();
  const path = `/api/v1/analytics/fair-price${query ? `?${query}` : ''}`;

  return useQuery({
    queryKey: ['fair-price', categoryId, categorySlug, zip],
    enabled: !!category,
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      try {
        return await api.getPublic<FairPrice>(path);
      } catch (error) {
        if (error instanceof ApiError && (error.status === 404 || error.status === 401)) {
          return { has_data: false } as FairPrice;
        }
        throw error;
      }
    },
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
  propertyId?: string,
) {
  const searchParams = new URLSearchParams();
  if (startDate) searchParams.set('start_date', startDate);
  if (endDate) searchParams.set('end_date', endDate);
  if (groupBy) searchParams.set('group_by', groupBy);
  if (propertyId) searchParams.set('property_id', propertyId);
  const query = searchParams.toString();
  const path = `/api/v1/analytics/customers/me/spending${query ? `?${query}` : ''}`;

  return useQuery({
    queryKey: ['customer-spending', startDate, endDate, groupBy, propertyId ?? null],
    queryFn: async () => {
      try {
        return await api.get<CustomerSpendingResponse>(path);
      } catch (error) {
        if (error instanceof ApiError && (error.status === 404 || error.status === 500)) return null;
        throw error;
      }
    },
    // Property-scoped cards soft-degrade; skip when id missing.
    enabled: propertyId === undefined || propertyId.length > 0,
    retry: false,
  });
}
