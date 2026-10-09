import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useMarkAllAsRead,
  useMarkAsRead,
  useNotificationPreferences,
  useNotifications,
  useUnreadCount,
  useUpdatePreferences,
} from '@/hooks/useNotifications';

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

const setUnreadCountMock = vi.fn();
const decrementUnreadMock = vi.fn();
const resetUnreadMock = vi.fn();

vi.mock('@/stores/notification-store', () => ({
  useNotificationStore: vi.fn(),
}));

// The list / unread-count / preferences queries are all gated on
// `enabled: isAuthenticated`, so the auth store has to report a signed-in
// session or they stay idle forever. Mutable so the signed-out path is
// assertable; only read inside the selector closure, so the hoisted factory
// never touches it before initialization.
const authState = { isAuthenticated: true, isHydrating: false };
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: <T,>(selector: (state: typeof authState) => T): T => selector(authState),
}));

const { api } = await import('@/lib/api');
const { useNotificationStore } = await import('@/stores/notification-store');

function primeStore() {
  vi.mocked(useNotificationStore).mockImplementation((selector: unknown) => {
    const state = {
      setUnreadCount: setUnreadCountMock,
      decrementUnread: decrementUnreadMock,
      resetUnread: resetUnreadMock,
      unreadCount: 0,
    };
    return typeof selector === 'function'
      ? (selector as (s: typeof state) => unknown)(state)
      : state;
  });
}

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

describe('useNotifications', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    primeStore();
    authState.isAuthenticated = true;
    client = qc();
  });
  afterEach(() => {
    client.clear();
    authState.isAuthenticated = true;
  });

  it('does not fetch notifications while signed out', () => {
    authState.isAuthenticated = false;
    const { result } = renderHook(() => useNotifications(), { wrapper: wrap(client) });
    expect(result.current.fetchStatus).toBe('idle');
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });

  it('fetches the notifications list with no params', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ notifications: [], total: 0 });
    const { result } = renderHook(() => useNotifications(), { wrapper: wrap(client) });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/notifications');
  });

  it('encodes unread_only + page + page_size into the query string', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ notifications: [], total: 0 });
    const { result } = renderHook(
      () => useNotifications({ unreadOnly: true, page: 2, pageSize: 25 }),
      { wrapper: wrap(client) },
    );
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/v1/notifications?unread_only=true&page=2&page_size=25',
    );
  });
});

describe('useUnreadCount', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    primeStore();
    client = qc();
  });
  afterEach(() => {
    client.clear();
  });

  it('fetches the unread count and pushes it into the zustand store', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ count: 4 });
    const { result } = renderHook(() => useUnreadCount(), { wrapper: wrap(client) });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.count).toBe(4);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/notifications/unread-count');
    expect(setUnreadCountMock).toHaveBeenCalledWith(4);
  });
});

describe('useMarkAsRead', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    primeStore();
    client = qc();
  });
  afterEach(() => {
    client.clear();
  });

  it('posts to the read endpoint, decrements the store, invalidates caches', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({});
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useMarkAsRead(), { wrapper: wrap(client) });
    result.current.mutate('notif-1');
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/notifications/notif-1/read');
    expect(decrementUnreadMock).toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith({ queryKey: ['notifications'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['notification-unread-count'] });
  });
});

describe('useMarkAllAsRead', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    primeStore();
    client = qc();
  });
  afterEach(() => {
    client.clear();
  });

  it('posts to read-all, resets the store, invalidates caches', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ marked_count: 7 });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useMarkAllAsRead(), { wrapper: wrap(client) });
    result.current.mutate();
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.marked_count).toBe(7);
    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/notifications/read-all');
    expect(resetUnreadMock).toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith({ queryKey: ['notifications'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['notification-unread-count'] });
  });
});

describe('useNotificationPreferences', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    primeStore();
    client = qc();
  });
  afterEach(() => {
    client.clear();
  });

  it('fetches the preferences', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ preferences: [] });
    const { result } = renderHook(() => useNotificationPreferences(), { wrapper: wrap(client) });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/notifications/preferences');
  });
});

describe('useUpdatePreferences', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    primeStore();
    client = qc();
  });
  afterEach(() => {
    client.clear();
  });

  it('puts the preferences payload and invalidates the preferences cache', async () => {
    vi.mocked(api.put).mockResolvedValueOnce({ preferences: [] });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useUpdatePreferences(), { wrapper: wrap(client) });
    const payload = {
      preferences: [{
        notification_type: 'new_bid' as const,
        push_enabled: false,
        email_enabled: true,
        sms_enabled: false,
        in_app_enabled: true,
      }],
    };
    result.current.mutate(payload);
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.put)).toHaveBeenCalledWith('/api/v1/notifications/preferences', payload);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['notification-preferences'] });
  });
});
