import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import {
  useEnableRole,
  useProfile,
  useSendPhoneOtp,
  useUpdateProfile,
  useVerifyPhone,
} from '@/hooks/useProfile';

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

const mockApiUser = {
  id: 'u-1',
  email: 'jane@example.com',
  display_name: 'Jane Doe',
  avatar_url: null,
  roles: ['customer' as const],
  status: 'active' as const,
  email_verified: true,
  phone: '+15551234567',
  phone_verified: false,
  mfa_enabled: false,
  created_at: '2026-01-01T00:00:00Z',
};

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

describe('useProfile', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    client = qc();
  });
  afterEach(() => {
    client.clear();
  });

  it('fetches /users/me and maps snake_case ApiUser into camelCase User', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(mockApiUser);
    const { result } = renderHook(() => useProfile(), { wrapper: wrap(client) });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/users/me');
    expect(result.current.data?.id).toBe('u-1');
    expect(result.current.data?.displayName).toBe('Jane Doe');
    expect(result.current.data?.emailVerified).toBe(true);
    expect(result.current.data?.phoneVerified).toBe(false);
    expect(result.current.data?.phone).toBe('+15551234567');
    expect(result.current.data?.mfaEnabled).toBe(false);
    expect(result.current.data?.avatarUrl).toBeNull();
  });
});

describe('useUpdateProfile', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    client = qc();
  });
  afterEach(() => {
    client.clear();
  });

  it('patches the profile, maps the response, invalidates the profile cache', async () => {
    vi.mocked(api.patch).mockResolvedValueOnce({ ...mockApiUser, display_name: 'Jane Renamed' });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateProfile(), { wrapper: wrap(client) });
    const input = { display_name: 'Jane Renamed' };
    result.current.mutate(input);
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.patch)).toHaveBeenCalledWith('/api/v1/users/me', input);
    expect(result.current.data?.displayName).toBe('Jane Renamed');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['profile'] });
  });
});

describe('useEnableRole', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    client = qc();
  });
  afterEach(() => {
    client.clear();
  });

  it('posts the role + invalidates the profile cache', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      ...mockApiUser,
      roles: ['customer', 'provider'],
    });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useEnableRole(), { wrapper: wrap(client) });
    result.current.mutate('provider');
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/users/me/roles', { role: 'provider' });
    expect(result.current.data?.roles).toContain('provider');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['profile'] });
  });
});

describe('useSendPhoneOtp', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    client = qc();
  });
  afterEach(() => {
    client.clear();
  });

  it('posts { phone } to send-phone-otp', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ sent: true });
    const { result } = renderHook(() => useSendPhoneOtp(), { wrapper: wrap(client) });
    result.current.mutate('+15551234567');
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/auth/send-phone-otp', {
      phone: '+15551234567',
    });
  });
});

describe('useVerifyPhone', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    client = qc();
  });
  afterEach(() => {
    client.clear();
  });

  it('posts { otp_code } and invalidates the profile cache', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ verified: true });
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useVerifyPhone(), { wrapper: wrap(client) });
    result.current.mutate('123456');
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/auth/verify-phone', {
      otp_code: '123456',
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['profile'] });
  });
});
