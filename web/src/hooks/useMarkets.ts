import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { Market } from '@/types';

interface UseMarketsOptions {
  /** Restrict to one country. Omit for the full catalog (US + MX). */
  country?: 'US' | 'MX';
  /** Only launched markets (is_active=true). Default false → full catalog. */
  activeOnly?: boolean;
}

/**
 * useMarkets fetches the public market catalog (cities/regions, craigslist-style
 * coverage). The catalog is near-static and edge-cached, so we treat it as
 * effectively immutable for the session (staleTime: Infinity). Search/filtering
 * by name happens client-side in MarketSelector — the full list is small enough
 * (~432 rows) to ship once and filter in-memory, which keeps typing instant.
 */
export function useMarkets(options: UseMarketsOptions = {}) {
  const { country, activeOnly } = options;
  const params = new URLSearchParams();
  if (country) params.set('country', country);
  if (activeOnly) params.set('active', 'true');
  const query = params.toString();
  const path = `/api/v1/markets${query ? `?${query}` : ''}`;

  return useQuery({
    queryKey: ['markets', country ?? 'all', activeOnly ?? false],
    queryFn: () => api.getPublic<{ markets: Market[] }>(path).then((res) => res.markets),
    staleTime: Infinity,
  });
}
