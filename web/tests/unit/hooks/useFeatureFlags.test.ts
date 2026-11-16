import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  defaultFeatureFlagValue,
  isFinancialFeatureFlag,
  useFeatureFlag,
  useFeatureFlags,
} from '@/hooks/useFeatureFlags';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    getPublic: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    code = 'ERR';
    userMessage(fallback: string) {
      return this.message || fallback;
    }
  },
}));
const { api } = await import('@/lib/api');

function qc() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}
function wrap(client: QueryClient) {
  return function W({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

describe('useFeatureFlags', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    client = qc();
  });
  afterEach(() => {
    client.clear();
  });

  it('fetches /api/v1/flags via getPublic and returns the gateway map verbatim', async () => {
    vi.mocked(api.getPublic).mockResolvedValueOnce({
      fair_price_index: true,
      live_auction: true,
      instant_payout: false,
    });

    const { result } = renderHook(() => useFeatureFlags(), { wrapper: wrap(client) });
    await waitFor(() => {
      expect(result.current.fair_price_index).toBe(true);
    });

    expect(vi.mocked(api.getPublic)).toHaveBeenCalledWith('/api/v1/flags');
    expect(result.current.fair_price_index).toBe(true);
    expect(result.current.live_auction).toBe(true);
    expect(result.current.instant_payout).toBe(false);
    expect(result.current.spectator_mode).toBeUndefined();
    expect(result.current.nomarkup_guarantee).toBeUndefined();
  });

  it('returns an empty map during the initial fetch (no network result yet)', () => {
    vi.mocked(api.getPublic).mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useFeatureFlags(), { wrapper: wrap(client) });

    expect(result.current.fair_price_index).toBeUndefined();
    expect(result.current.live_auction).toBeUndefined();
  });
});

describe('useFeatureFlag', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    client = qc();
  });
  afterEach(() => {
    client.clear();
  });

  it('returns true for a flag the gateway reports as enabled', async () => {
    vi.mocked(api.getPublic).mockResolvedValueOnce({ spectator_mode: true });

    const { result } = renderHook(() => useFeatureFlag('spectator_mode'), {
      wrapper: wrap(client),
    });

    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });

  it('returns false ONLY when the gateway explicitly reports the flag disabled', async () => {
    vi.mocked(api.getPublic).mockResolvedValueOnce({ instant_payout: false });

    const { result } = renderHook(() => useFeatureFlag('instant_payout'), {
      wrapper: wrap(client),
    });

    // Financial flags start false (fail-closed) even while loading.
    expect(result.current).toBe(false);

    await waitFor(() => {
      expect(result.current).toBe(false);
    });
  });

  it('fails OPEN (returns true) for a missing core flag', async () => {
    vi.mocked(api.getPublic).mockResolvedValueOnce({ live_auction: true });

    const { result } = renderHook(() => useFeatureFlag('nomarkup_guarantee'), {
      wrapper: wrap(client),
    });

    await waitFor(() => {
      expect(vi.mocked(api.getPublic)).toHaveBeenCalled();
    });
    expect(result.current).toBe(true);
  });

  it('fails CLOSED (returns false) for a missing financial flag (SEC-02)', async () => {
    vi.mocked(api.getPublic).mockResolvedValueOnce({ live_auction: true });

    const { result } = renderHook(() => useFeatureFlag('working_capital'), {
      wrapper: wrap(client),
    });

    await waitFor(() => {
      expect(vi.mocked(api.getPublic)).toHaveBeenCalled();
    });
    expect(result.current).toBe(false);
  });
});

describe('defaultFeatureFlagValue / isFinancialFeatureFlag', () => {
  it('classifies financial keys as fail-closed', () => {
    for (const key of [
      'customer_bnpl',
      'working_capital',
      'instant_payout',
      'per_job_insurance',
      'insurance_competition',
      'legal_services',
      'lead_gen',
    ] as const) {
      expect(isFinancialFeatureFlag(key)).toBe(true);
      expect(defaultFeatureFlagValue(key)).toBe(false);
    }
  });

  it('classifies core keys as fail-open', () => {
    for (const key of [
      'live_auction',
      'spectator_mode',
      'marketplace_offers',
      'nomarkup_guarantee',
      'smart_matching',
      'provider_business_os',
      'fair_price_index',
      'background_checks',
    ] as const) {
      expect(isFinancialFeatureFlag(key)).toBe(false);
      expect(defaultFeatureFlagValue(key)).toBe(true);
    }
  });
});
