import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useProfile, useUpdateProfile, useEnableRole } from '@/hooks/useProfile';
import type { User } from '@/types';

// Note: useAuth.ts does not exist in the codebase. The auth logic lives in
// the auth store (tested in auth-store.test.ts). This file tests useProfile
// hooks which provide the authenticated user data fetching.

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

const { api } = await import('@/lib/api');

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

const mockUser: User = {
  id: 'user-1',
  email: 'test@example.com',
  displayName: 'Test User',
  avatarUrl: 'https://example.com/avatar.png',
  roles: ['customer'],
  status: 'active',
  emailVerified: true,
  phoneVerified: false,
  mfaEnabled: false,
  createdAt: '2026-01-01T00:00:00Z',
};

describe('useProfile', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches the current user profile', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ user: mockUser });

    const { result } = renderHook(() => useProfile(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.id).toBe('user-1');
    expect(result.current.data?.email).toBe('test@example.com');
    expect(result.current.data?.displayName).toBe('Test User');
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/users/me');
  });

  it('starts in loading state', () => {
    vi.mocked(api.get).mockReturnValueOnce(new Promise(() => {}));

    const { result } = renderHook(() => useProfile(), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it('handles fetch error', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Unauthorized'));

    const { result } = renderHook(() => useProfile(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBeDefined();
  });
});

describe('useUpdateProfile', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('updates the user profile and invalidates queries', async () => {
    const updatedUser = { ...mockUser, displayName: 'Updated Name' };
    vi.mocked(api.patch).mockResolvedValueOnce({ user: updatedUser });

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateProfile(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ display_name: 'Updated Name' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.displayName).toBe('Updated Name');
    expect(vi.mocked(api.patch)).toHaveBeenCalledWith('/api/v1/users/me', {
      display_name: 'Updated Name',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['profile'] });
  });

  it('handles update error', async () => {
    vi.mocked(api.patch).mockRejectedValueOnce(
      new Error('Validation failed'),
    );

    const { result } = renderHook(() => useUpdateProfile(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ display_name: 'X' });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useEnableRole', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('enables a new role for the user', async () => {
    const updatedUser = {
      ...mockUser,
      roles: ['customer', 'provider'] as const,
    };
    vi.mocked(api.post).mockResolvedValueOnce({ user: updatedUser });

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useEnableRole(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate('provider');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.roles).toContain('provider');
    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/users/me/roles',
      { role: 'provider' },
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['profile'] });
  });

  it('handles role enable error', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(
      new Error('Role already enabled'),
    );

    const { result } = renderHook(() => useEnableRole(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate('provider');

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
