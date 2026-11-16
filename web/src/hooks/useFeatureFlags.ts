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
  'background_checks',
  // Service verticals
  'legal_services',
  // Financial features (each enforced by RequireFlag in the gateway)
  'customer_bnpl',
  'instant_payout',
  'per_job_insurance',
  'insurance_competition',
  'working_capital',
  'lead_gen',
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];

/**
 * Money / financial / liability surfaces. Missing or still-loading keys default
 * to DISABLED (`false`) so the UI fails closed (SEC-02). Gateway `RequireFlag`
 * still enforces the real off switch with 503 — this only keeps entry points
 * hidden until the flags endpoint confirms they are on.
 */
export const FINANCIAL_FEATURE_FLAG_KEYS = [
  'customer_bnpl',
  'working_capital',
  'instant_payout',
  'per_job_insurance',
  'insurance_competition',
  'legal_services',
  'lead_gen',
] as const satisfies readonly FeatureFlagKey[];

export type FinancialFeatureFlagKey = (typeof FINANCIAL_FEATURE_FLAG_KEYS)[number];

const FINANCIAL_FLAG_SET: ReadonlySet<string> = new Set(FINANCIAL_FEATURE_FLAG_KEYS);

export function isFinancialFeatureFlag(key: FeatureFlagKey): boolean {
  return FINANCIAL_FLAG_SET.has(key);
}

/**
 * Default for a missing/loading flag:
 * - financial keys → false (fail-closed UI)
 * - core product flags → true (fail-open UX so entry points don't flicker)
 */
export function defaultFeatureFlagValue(key: FeatureFlagKey): boolean {
  return !isFinancialFeatureFlag(key);
}

/**
 * The public flags endpoint returns a flat map of key → enabled. Only keys that
 * exist in the DB are present; a missing key means "not configured". See
 * `useFeatureFlag` / `defaultFeatureFlagValue` for how absence is interpreted.
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
 * Returns whether a feature is enabled.
 *
 * - **Core flags** (auction, marketplace, guarantee, …): default ENABLED
 *   (`true`) when missing/loading so entry points don't flicker off during the
 *   initial fetch or a flags-endpoint outage.
 * - **Financial flags** (`FINANCIAL_FEATURE_FLAG_KEYS`): default DISABLED
 *   (`false`) when missing/loading — fail-closed UI for money, insurance, BNPL,
 *   legal, and lead-gen surfaces (SEC-02).
 *
 * The gateway independently enforces every gated flag (503 on a real "off"), so
 * an optimistic core `true` cannot bypass an actually-disabled feature. A flag
 * is hidden when the backend explicitly reports `false`, or when a financial
 * key is still unknown.
 */
export function useFeatureFlag(key: FeatureFlagKey): boolean {
  const flags = useFeatureFlags();
  return flags[key] ?? defaultFeatureFlagValue(key);
}
