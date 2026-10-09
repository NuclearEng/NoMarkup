import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  backgroundCheckInvitationURL,
  canStartBackgroundCheck,
  formatBackgroundCheckStatus,
  normalizeBackgroundCheckStatus,
  useBackgroundCheck,
  useStartBackgroundCheck,
} from '@/hooks/useBackgroundCheck';

vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      public body: string,
    ) {
      super(`API ${String(status)}: ${body}`);
      this.name = 'ApiError';
    }
    userMessage(fallback: string): string {
      try {
        const parsed = JSON.parse(this.body) as { error?: string };
        if (parsed.error) return parsed.error;
      } catch {
        // not JSON
      }
      return this.body || fallback;
    }
  }
  return {
    api: {
      get: vi.fn(),
      post: vi.fn(),
    },
    ApiError,
    getApiErrorMessage: (err: unknown, fallback: string) => {
      if (err instanceof ApiError) return err.userMessage(fallback);
      if (err instanceof Error) return err.message;
      return fallback;
    },
  };
});

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

describe('background check status helpers', () => {
  it('never formats a pass / passed label', () => {
    expect(formatBackgroundCheckStatus('clear')).toBe('Clear');
    expect(formatBackgroundCheckStatus('consider')).toBe('Consider');
    expect(formatBackgroundCheckStatus('pending')).toBe('Pending');
    expect(formatBackgroundCheckStatus('not_started')).toBe('Not started');
    expect(formatBackgroundCheckStatus('pass')).toBe('pass');
    expect(formatBackgroundCheckStatus('passed')).toBe('passed');
    for (const status of ['clear', 'consider', 'pending', 'complete', 'not_started']) {
      expect(formatBackgroundCheckStatus(status).toLowerCase()).not.toMatch(/pass/);
    }
  });

  it('normalizes empty to not_started', () => {
    expect(normalizeBackgroundCheckStatus('')).toBe('not_started');
    expect(normalizeBackgroundCheckStatus(null)).toBe('not_started');
  });

  it('allows start only from terminal-absent states', () => {
    expect(canStartBackgroundCheck('not_started')).toBe(true);
    expect(canStartBackgroundCheck('canceled')).toBe(true);
    expect(canStartBackgroundCheck('pending')).toBe(false);
    expect(canStartBackgroundCheck('clear')).toBe(false);
    expect(canStartBackgroundCheck('consider')).toBe(false);
  });

  it('returns invitation_url when it is http(s)', () => {
    expect(
      backgroundCheckInvitationURL({
        status: 'pending',
        invitation_url: 'https://apply.checkr.com/invite/abc',
      }),
    ).toBe('https://apply.checkr.com/invite/abc');
    expect(
      backgroundCheckInvitationURL({
        status: 'pending',
        report_url: 'https://apply.checkr.com/invite/from-report',
      }),
    ).toBe('https://apply.checkr.com/invite/from-report');
    expect(backgroundCheckInvitationURL({ status: 'pending', report_url: 'rep_1' })).toBeNull();
  });
});

describe('useBackgroundCheck', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    client = qc();
  });
  afterEach(() => {
    client.clear();
  });

  it('GETs /providers/me/background-check', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      status: 'pending',
      invitation_url: 'https://apply.checkr.com/invite/x',
    });
    const { result } = renderHook(() => useBackgroundCheck(), { wrapper: wrap(client) });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/providers/me/background-check');
    expect(result.current.data?.invitation_url).toBe('https://apply.checkr.com/invite/x');
    expect(result.current.data?.status).toBe('pending');
  });
});

describe('useStartBackgroundCheck', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    client = qc();
  });
  afterEach(() => {
    client.clear();
  });

  it('POSTs and caches the vendor row without inventing clear', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      status: 'pending',
      invitation_url: 'https://apply.checkr.com/invite/new',
    });
    const { result } = renderHook(() => useStartBackgroundCheck(), { wrapper: wrap(client) });
    result.current.mutate();
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/providers/me/background-check',
      {},
    );
    expect(result.current.data?.status).toBe('pending');
    expect(result.current.data?.status).not.toBe('clear');
  });
});
