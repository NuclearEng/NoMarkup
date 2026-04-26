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

  it('fetches /api/v1/flags via getPublic and merges over the default-false set', async () => {
    vi.mocked(api.getPublic).mockResolvedValueOnce({
      fair_price_index: true,
      live_auction: true,
    });

    const { result } = renderHook(() => useFeatureFlags(), { wrapper: wrap(client) });
    await waitFor(() => {
      expect(result.current.fair_price_index).toBe(true);
    });

    expect(vi.mocked(api.getPublic)).toHaveBeenCalledWith('/api/v1/flags');
    expect(result.current.fair_price_index).toBe(true);
    expect(result.current.live_auction).toBe(true);
    // Defaults still present for unsent flags.
    expect(result.current.spectator_mode).toBe(false);
    expect(result.current.nomarkup_guarantee).toBe(false);
    expect(result.current.smart_matching).toBe(false);
    expect(result.current.provider_business_os).toBe(false);
  });

  it('falls back to all-false defaults during initial fetch (no network result yet)', () => {
    // Mock a never-resolving fetch so the query stays pending.
    vi.mocked(api.getPublic).mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useFeatureFlags(), { wrapper: wrap(client) });

    expect(result.current.fair_price_index).toBe(false);
    expect(result.current.live_auction).toBe(false);
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

  it('returns the boolean for a specific flag once flags resolve', async () => {
    vi.mocked(api.getPublic).mockResolvedValueOnce({ spectator_mode: true });

    const { result } = renderHook(() => useFeatureFlag('spectator_mode'), {
      wrapper: wrap(client),
    });

    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });

  it('returns false for a flag that is missing from the response', async () => {
    vi.mocked(api.getPublic).mockResolvedValueOnce({ live_auction: true });

    const { result } = renderHook(() => useFeatureFlag('nomarkup_guarantee'), {
      wrapper: wrap(client),
    });

    // Wait for the network call to settle so default merge has happened.
    await waitFor(() => {
      expect(vi.mocked(api.getPublic)).toHaveBeenCalled();
    });
    expect(result.current).toBe(false);
  });

  it('returns false (via ?? fallback) for a flag absent from both response and DEFAULT_FLAGS', async () => {
    // The FeatureFlags interface has an index signature [key: string]: boolean,
    // so callers can ask for arbitrary flag names. When the key is not in the
    // gateway response AND not in DEFAULT_FLAGS, the index access returns
    // undefined and the `?? false` fallback kicks in.
    vi.mocked(api.getPublic).mockResolvedValueOnce({ fair_price_index: true });

    const { result } = renderHook(
      () => useFeatureFlag('not_a_real_flag' as 'fair_price_index'),
      { wrapper: wrap(client) },
    );

    await waitFor(() => {
      expect(vi.mocked(api.getPublic)).toHaveBeenCalled();
    });
    expect(result.current).toBe(false);
  });
});
