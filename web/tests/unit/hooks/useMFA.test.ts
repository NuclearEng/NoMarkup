import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useDisableMFA,
  useEnableMFA,
  useVerifyMFALogin,
  useVerifyMFASetup,
} from '@/hooks/useMFA';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    getPublic: vi.fn(),
    post: vi.fn(),
    postUnauthed: vi.fn(),
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

describe('useEnableMFA', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    client = qc();
  });
  afterEach(() => {
    client.clear();
  });

  it('posts to the enable endpoint with no body and returns the secret + qr + backup codes', async () => {
    const response = {
      secret: 'JBSWY3DPEHPK3PXP',
      qr_code_url: 'otpauth://totp/...',
      backup_codes: ['code-1', 'code-2'],
    };
    vi.mocked(api.post).mockResolvedValueOnce(response);

    const { result } = renderHook(() => useEnableMFA(), { wrapper: wrap(client) });
    result.current.mutate();
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/auth/mfa/enable');
    expect(result.current.data?.secret).toBe('JBSWY3DPEHPK3PXP');
    expect(result.current.data?.backup_codes).toHaveLength(2);
  });
});

describe('useVerifyMFASetup', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    client = qc();
  });
  afterEach(() => {
    client.clear();
  });

  it('posts the totp + backup codes and invalidates the profile cache', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useVerifyMFASetup(), { wrapper: wrap(client) });
    const input = { totp_code: '123456', backup_codes: ['code-1'] };
    result.current.mutate(input);
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/auth/mfa/verify-setup', input);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['profile'] });
  });
});

describe('useDisableMFA', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    client = qc();
  });
  afterEach(() => {
    client.clear();
  });

  it('deletes with the totp code in the body and invalidates the profile cache', async () => {
    vi.mocked(api.delete).mockResolvedValueOnce({ success: true });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useDisableMFA(), { wrapper: wrap(client) });
    result.current.mutate({ totp_code: '654321' });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.delete)).toHaveBeenCalledWith('/api/v1/auth/mfa/disable', {
      totp_code: '654321',
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['profile'] });
  });
});

describe('useVerifyMFALogin', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    client = qc();
  });
  afterEach(() => {
    client.clear();
  });

  it('uses the unauth endpoint and returns the access token + expiry', async () => {
    const response = {
      access_token: 'jwt-token',
      access_token_expires_at: '2026-04-25T01:00:00Z',
    };
    vi.mocked(api.postUnauthed).mockResolvedValueOnce(response);

    const { result } = renderHook(() => useVerifyMFALogin(), { wrapper: wrap(client) });
    const input = { mfa_challenge_token: 'challenge-1', totp_code: '123456' };
    result.current.mutate(input);
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.postUnauthed)).toHaveBeenCalledWith('/api/v1/auth/mfa/verify', input);
    expect(result.current.data?.access_token).toBe('jwt-token');
  });
});
