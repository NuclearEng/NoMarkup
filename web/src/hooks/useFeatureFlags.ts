import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

interface FeatureFlags {
  fair_price_index: boolean;
  spectator_mode: boolean;
  nomarkup_guarantee: boolean;
  smart_matching: boolean;
  provider_business_os: boolean;
  live_auction: boolean;
  [key: string]: boolean;
}

const DEFAULT_FLAGS: FeatureFlags = {
  fair_price_index: false,
  spectator_mode: false,
  nomarkup_guarantee: false,
  smart_matching: false,
  provider_business_os: false,
  live_auction: false,
};

export function useFeatureFlags() {
  const { data: flags = DEFAULT_FLAGS } = useQuery<FeatureFlags>({
    queryKey: ['feature-flags'],
    queryFn: async () => {
      const response = await api.getPublic<FeatureFlags>('/api/v1/flags');
      return { ...DEFAULT_FLAGS, ...response };
    },
    staleTime: 60 * 1000, // Refresh every minute
    retry: 1,
  });

  return flags;
}

export function useFeatureFlag(key: keyof FeatureFlags): boolean {
  const flags = useFeatureFlags();
  return flags[key] ?? false;
}
