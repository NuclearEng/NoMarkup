import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

/**
 * Feature flag keys recognized by the web app. These mirror the canonical
 * `feature_flags.key` values stored in PostgreSQL and enforced server-side by
 * the gateway's `RequireFlag` middleware (a genuinely-off feature returns 503).
 *
 * The frontend gating here is a UX layer: when a flag is OFF we hide the entry
 * point so users never see a broken/dead surface. The backend remains the
 * source of truth.
 */
export const FEATURE_FLAG_KEYS = [
  // Auction / marketplace experience
  'live_auction',
  'spectator_mode',
  'marketplace_offers',
  'nomarkup_guarantee',
  'smart_matching',
  'provider_business_os',
  'fair_price_index',
  // Financial features (each enforced by RequireFlag in the gateway)
  'customer_bnpl',
  'instant_payout',
  'per_job_insurance',
  'working_capital',
  'lead_gen',
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];

/**
 * The public flags endpoint returns a flat map of key → enabled. Only keys that
 * exist in the DB are present; a missing key means "not configured", which we
 * treat as ENABLED (fail-open — see `useFeatureFlag`).
 */
export type FeatureFlags = Partial<Record<FeatureFlagKey, boolean>> & {
  [key: string]: boolean | undefined;
};

const FLAGS_QUERY_KEY = ['feature-flags'] as const;

export function useFeatureFlags(): FeatureFlags {
  const { data: flags = {} } = useQuery<FeatureFlags>({
    queryKey: FLAGS_QUERY_KEY,
    queryFn: async () => {
      const response = await api.getPublic<FeatureFlags>('/api/v1/flags');
      return response;
    },
    staleTime: 60 * 1000, // Refresh at most once a minute
    retry: 1,
  });

  return flags;
}

/**
 * Returns whether a feature is enabled, defaulting to ENABLED (`true`) when the
 * flag is missing or still loading.
 *
 * Rationale: we fail toward showing the feature so nothing flickers off during
 * the initial load and a flags-endpoint outage never hides working UI. The
 * gateway independently enforces every gated flag (503 on a real "off"), so a
 * stale/optimistic `true` here cannot bypass an actually-disabled feature — it
 * only affects whether the entry point is rendered. A flag is hidden ONLY when
 * the backend explicitly reports `false`.
 */
export function useFeatureFlag(key: FeatureFlagKey): boolean {
  const flags = useFeatureFlags();
  return flags[key] ?? true;
}
