// useProfile — branches useProfile.test.ts leaves untested. Mostly
// useEnableRole's session handoff: the freshly minted access token must
// replace the pre-grant one whatever shape the JWT/user document arrive in,
// and the enable-role response must be MERGED onto the signed-in user so
// empty fields in the response never wipe what the store already knows.
// Also: phone defaulting, and the OTP hooks' failure copy.
//
// The real auth store, JWT parser and ApiError are used; only the transport
// is replaced.
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useEnableRole,
  useProfile,
  useSendPhoneOtp,
  useUpdateProfile,
  useVerifyPhone,
} from '@/hooks/useProfile';
import { getAccessToken } from '@/lib/auth';
import { useAuthStore } from '@/stores/auth-store';
import type { User } from '@/types';

const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => {
      toastSuccess(...a);
    },
    error: (...a: unknown[]) => {
      toastError(...a);
    },
  },
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
    },
  };
});

const { api, ApiError } = await import('@/lib/api');

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

function createWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

function unsignedJwt(claims: { sub: string; email: string; roles: string[] }): string {
  const json = JSON.stringify({ ...claims, exp: 9_999_999_999, iat: 1 });
  return `e30.${Buffer.from(json, 'utf8').toString('base64')}.sig`;
}

const apiUser = {
  id: 'u-1',
  email: 'jane@example.com',
  display_name: 'Jane Doe',
  avatar_url: null,
  roles: ['customer', 'provider'],
  status: 'active',
  email_verified: true,
  phone: '+15551234567',
  phone_verified: true,
  mfa_enabled: true,
  created_at: '2026-01-01T00:00:00Z',
};

const storedUser: User = {
  id: 'u-stored',
  email: 'stored@example.com',
  displayName: 'Stored Name',
  avatarUrl: 'https://cdn.example/avatar.png',
  roles: ['customer'],
  status: 'active',
  emailVerified: false,
  phone: '+15550000000',
  phoneVerified: false,
  mfaEnabled: false,
  createdAt: '2025-06-01T00:00:00Z',
};

let queryClient: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = createTestQueryClient();
  useAuthStore.getState().reset();
});

afterEach(() => {
  queryClient.clear();
  useAuthStore.getState().reset();
});

async function enableRole(response: Record<string, unknown>): Promise<User | undefined> {
  vi.mocked(api.post).mockResolvedValueOnce(response);
  const { result } = renderHook(() => useEnableRole(), { wrapper: createWrapper(queryClient) });
  result.current.mutate('provider');
  await waitFor(() => {
    expect(result.current.isSuccess).toBe(true);
  });
  return result.current.data;
}

describe('mapApiUser phone defaulting', () => {
  it('useProfile maps an absent phone to null', async () => {
    const { phone: _omitted, ...withoutPhone } = apiUser;
    vi.mocked(api.get).mockResolvedValueOnce(withoutPhone);

    const { result } = renderHook(() => useProfile(), { wrapper: createWrapper(queryClient) });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(_omitted).toBe('+15551234567');
    expect(result.current.data?.phone).toBeNull();
    expect(queryClient.getQueryData<User>(['profile'])?.phone).toBeNull();
  });

  it('useUpdateProfile leaves the profile cache alone when the PATCH fails', async () => {
    vi.mocked(api.patch).mockRejectedValueOnce(new ApiError(400, 'bad'));
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateProfile(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({ display_name: 'X' });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe('useEnableRole session handoff', () => {
  it('without a token and without a signed-in user, the auth store is left untouched', async () => {
    const user = await enableRole({ ...apiUser, access_token: '   ' });

    expect(user?.roles).toEqual(['customer', 'provider']);
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(getAccessToken()).toBeNull();
  });

  it('adopts the session under the JWT subject when the user document has no id', async () => {
    const token = unsignedJwt({ sub: 'u-jwt', email: 'jwt@example.com', roles: ['provider'] });

    await enableRole({ ...apiUser, id: '', access_token: token });

    const state = useAuthStore.getState();
    expect(getAccessToken()).toBe(token);
    expect(state.accessToken).toBe(token);
    expect(state.isAuthenticated).toBe(true);
    // id falls back to the JWT-derived store user; display fields come from
    // the response, which a bare JWT cannot supply.
    expect(state.user?.id).toBe('u-jwt');
    expect(state.user?.displayName).toBe('Jane Doe');
    expect(state.user?.email).toBe('jane@example.com');
    expect(state.user?.roles).toEqual(['customer', 'provider']);
  });

  it('adopts the session under the document id when the JWT has an empty subject', async () => {
    const token = unsignedJwt({ sub: '', email: 'jwt@example.com', roles: ['provider'] });

    await enableRole({
      ...apiUser,
      access_token: token,
      access_token_expires_at: '2026-11-16T12:15:00Z',
    });

    const state = useAuthStore.getState();
    expect(state.accessToken).toBe(token);
    expect(state.user?.id).toBe('u-1');
    expect(state.user?.mfaEnabled).toBe(true);
  });

  it.each([
    {
      name: 'a token that is not a JWT',
      token: 'opaque-token',
    },
    {
      name: 'a JWT with no subject and a document with no id',
      token: unsignedJwt({ sub: '', email: 'jwt@example.com', roles: ['provider'] }),
      id: '',
    },
  ])('still stores $name and seeds the user from the response', async ({ token, id }) => {
    await enableRole({ ...apiUser, ...(id === undefined ? {} : { id }), access_token: token });

    const state = useAuthStore.getState();
    expect(getAccessToken()).toBe(token);
    expect(state.accessToken).toBe(token);
    expect(state.isAuthenticated).toBe(true);
    expect(state.isHydrating).toBe(false);
    expect(state.user).toEqual({
      id: id ?? 'u-1',
      email: 'jane@example.com',
      displayName: 'Jane Doe',
      avatarUrl: null,
      roles: ['customer', 'provider'],
      status: 'active',
      emailVerified: true,
      phone: '+15551234567',
      phoneVerified: true,
      mfaEnabled: true,
      createdAt: '2026-01-01T00:00:00Z',
    });
  });

  it('trims whitespace around the token before storing it', async () => {
    const token = unsignedJwt({ sub: 'u-1', email: 'jane@example.com', roles: ['provider'] });

    await enableRole({ ...apiUser, access_token: `  ${token}\n` });

    expect(getAccessToken()).toBe(token);
    expect(useAuthStore.getState().accessToken).toBe(token);
  });
});

describe('useEnableRole merge onto the signed-in user', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: storedUser,
      accessToken: 'old-token',
      isAuthenticated: true,
      isHydrating: false,
    });
  });

  it('empty response fields never wipe what the store already knows', async () => {
    await enableRole({
      id: '',
      email: '',
      display_name: '',
      avatar_url: null,
      roles: [],
      status: 'suspended',
      email_verified: true,
      phone_verified: true,
      mfa_enabled: true,
      created_at: '',
    });

    const state = useAuthStore.getState();
    expect(state.user).toEqual({
      ...storedUser,
      // Status and verification flags always come from the server.
      status: 'suspended',
      emailVerified: true,
      phoneVerified: true,
      mfaEnabled: true,
    });
    // No token in the response: the existing session token is kept.
    expect(state.accessToken).toBe('old-token');
  });

  it('populated response fields replace the stored ones', async () => {
    await enableRole({ ...apiUser, avatar_url: 'https://cdn.example/new.png' });

    expect(useAuthStore.getState().user).toEqual({
      id: 'u-1',
      email: 'jane@example.com',
      displayName: 'Jane Doe',
      avatarUrl: 'https://cdn.example/new.png',
      roles: ['customer', 'provider'],
      status: 'active',
      emailVerified: true,
      phone: '+15551234567',
      phoneVerified: true,
      mfaEnabled: true,
      createdAt: '2026-01-01T00:00:00Z',
    });
  });

  it('a new token replaces the pre-grant one but the stored display name survives', async () => {
    const token = unsignedJwt({ sub: 'u-stored', email: 'stored@example.com', roles: ['provider'] });

    await enableRole({ ...apiUser, id: 'u-stored', display_name: '', access_token: token });

    const state = useAuthStore.getState();
    expect(state.accessToken).toBe(token);
    expect(getAccessToken()).toBe(token);
    expect(state.user?.displayName).toBe('Stored Name');
    expect(state.user?.roles).toEqual(['customer', 'provider']);
  });

  it('a rejected grant changes neither the store nor the profile cache', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError(403, 'forbidden'));
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useEnableRole(), { wrapper: createWrapper(queryClient) });
    result.current.mutate('provider');
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(useAuthStore.getState().user).toEqual(storedUser);
    expect(useAuthStore.getState().accessToken).toBe('old-token');
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe('phone OTP failure copy', () => {
  interface OtpHandle {
    isSuccess: boolean;
    isError: boolean;
    mutate: (value: string) => void;
  }

  interface OtpCase {
    name: string;
    use: () => OtpHandle;
    success: string;
    fallback: string;
  }

  const CASES: OtpCase[] = [
    {
      name: 'useSendPhoneOtp',
      use: () => useSendPhoneOtp(),
      success: 'Verification code sent',
      fallback: 'Failed to send verification code',
    },
    {
      name: 'useVerifyPhone',
      use: () => useVerifyPhone(),
      success: 'Phone verified',
      fallback: 'Failed to verify phone',
    },
  ];

  it.each(CASES)('$name confirms success with a toast', async ({ use, success }) => {
    vi.mocked(api.post).mockResolvedValueOnce({});

    const { result } = renderHook(use, { wrapper: createWrapper(queryClient) });
    result.current.mutate('123456');
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(toastSuccess).toHaveBeenCalledWith(success);
    expect(toastError).not.toHaveBeenCalled();
  });

  it.each(CASES)('$name shows the gateway reason for an ApiError', async ({ use }) => {
    vi.mocked(api.post).mockRejectedValueOnce(
      new ApiError(429, JSON.stringify({ error: 'too many attempts, try again in 15 minutes' })),
    );
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(use, { wrapper: createWrapper(queryClient) });
    result.current.mutate('123456');
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(toastError).toHaveBeenCalledWith('too many attempts, try again in 15 minutes');
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it.each(CASES)('$name shows its fallback for a non-API failure', async ({ use, fallback }) => {
    vi.mocked(api.post).mockRejectedValueOnce(new TypeError('network down'));

    const { result } = renderHook(use, { wrapper: createWrapper(queryClient) });
    result.current.mutate('123456');
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(toastError).toHaveBeenCalledWith(fallback);
  });
});
