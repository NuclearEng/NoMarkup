import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFeatureFlag, useFeatureFlags } from '@/hooks/useFeatureFlags';

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
    // An explicitly-disabled flag is reported as false.
    expect(result.current.instant_payout).toBe(false);
    // Flags not present in the response are simply absent (undefined), and the
    // accessor treats absence as enabled (fail-open) — see the useFeatureFlag suite.
    expect(result.current.spectator_mode).toBeUndefined();
    expect(result.current.nomarkup_guarantee).toBeUndefined();
  });

  it('returns an empty map during the initial fetch (no network result yet)', () => {
    // Mock a never-resolving fetch so the query stays pending.
    vi.mocked(api.getPublic).mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useFeatureFlags(), { wrapper: wrap(client) });

    // No data yet — flags are absent, so the accessor will fail-open to enabled.
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

    // Wait for the resolved value (until then it fail-opens to true).
    await waitFor(() => {
      expect(result.current).toBe(false);
    });
  });

  it('fails OPEN (returns true) for a flag absent from the response', async () => {
    // Fail-open: a flag the gateway does not mention is treated as enabled so
    // nothing flickers off during load or a flags-endpoint outage. The backend
    // still enforces a genuinely-off feature with a 503.
    vi.mocked(api.getPublic).mockResolvedValueOnce({ live_auction: true });

    const { result } = renderHook(() => useFeatureFlag('nomarkup_guarantee'), {
      wrapper: wrap(client),
    });

    await waitFor(() => {
      expect(vi.mocked(api.getPublic)).toHaveBeenCalled();
    });
    expect(result.current).toBe(true);
  });
});
