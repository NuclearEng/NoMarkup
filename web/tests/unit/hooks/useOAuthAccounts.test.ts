import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useOAuthAccounts, useUnlinkOAuthAccount } from '@/hooks/useOAuthAccounts';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    delete: vi.fn(),
  },
  getApiErrorMessage: (err: unknown, fallback: string) =>
    err instanceof Error ? err.message : fallback,
}));

const { api } = (await import('@/lib/api')) as unknown as {
  api: { get: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
};

function createWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

describe('useOAuthAccounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('GETs /api/v1/users/me/oauth-accounts', async () => {
    api.get.mockResolvedValue({
      accounts: [{ provider: 'google', email: 'a@b.c', linked_at: '2026-01-01T00:00:00Z' }],
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useOAuthAccounts(), { wrapper: createWrapper(qc) });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(api.get).toHaveBeenCalledWith('/api/v1/users/me/oauth-accounts');
    expect(result.current.data?.accounts).toHaveLength(1);
  });

  it('useUnlinkOAuthAccount DELETEs the provider path', async () => {
    api.delete.mockResolvedValue({ unlinked: true, provider: 'google' });
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { result } = renderHook(() => useUnlinkOAuthAccount(), { wrapper: createWrapper(qc) });
    result.current.mutate('google');
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(api.delete).toHaveBeenCalledWith('/api/v1/users/me/oauth-accounts/google');
  });
});
