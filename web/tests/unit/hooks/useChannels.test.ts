import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useChannels,
  useChannel,
  useMessages,
  useSendMessage,
  useMarkRead,
  useUnreadCount,
} from '@/hooks/useChannels';
import type { Channel, ChannelsResponse, ChatMessage, MessagesResponse } from '@/types';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    getPublic: vi.fn(),
    post: vi.fn(),
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

// `useUnreadCount` gates its query on `enabled: isAuthenticated`, so the auth
// store has to report a signed-in session or the query never fires. Mutable so
// a test can assert the signed-out (disabled) path too. Only dereferenced
// inside the selector closure, so the hoisted factory is safe.
const authState = { isAuthenticated: true, isHydrating: false };
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: <T,>(selector: (state: typeof authState) => T): T => selector(authState),
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
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const mockChannel: Channel = {
  id: 'ch-1',
  job_id: 'job-1',
  customer_id: 'cust-1',
  provider_id: 'prov-1',
  channel_type: 'pre_award',
  status: 'active',
  unread_count: 0,
  message_count: 0,
  created_at: '2026-04-25T00:00:00Z',
  updated_at: '2026-04-25T00:00:00Z',
};

const mockMessage: ChatMessage = {
  id: 'msg-1',
  channel_id: 'ch-1',
  sender_id: 'cust-1',
  message_type: 'text',
  content: 'hi there',
  flagged_contact_info: false,
  is_deleted: false,
  created_at: '2026-04-25T00:01:00Z',
};

describe('useChannels', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches the channel list with no params', async () => {
    const response: ChannelsResponse = {
      channels: [mockChannel],
      pagination: { totalCount: 1, page: 1, pageSize: 25, totalPages: 1, hasNext: false },
    };
    vi.mocked(api.get).mockResolvedValueOnce(response);

    const { result } = renderHook(() => useChannels(), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data?.channels).toHaveLength(1);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/channels');
  });

  it('appends pagination params to the URL when provided', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ channels: [], total: 0 });

    const { result } = renderHook(() => useChannels({ page: 2, per_page: 25 }), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/channels?page=2&per_page=25');
  });
});

describe('useChannel', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('wraps the unwrapped gateway response in { channel }', async () => {
    // Gateway returns the bare Channel, hook re-wraps for consumer shape.
    vi.mocked(api.get).mockResolvedValueOnce(mockChannel);

    const { result } = renderHook(() => useChannel('ch-1'), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data?.channel.id).toBe('ch-1');
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/channels/ch-1');
  });

  it('does not fetch when id is empty', () => {
    const { result } = renderHook(() => useChannel(''), {
      wrapper: createWrapper(queryClient),
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });
});

describe('useMessages', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches messages with no pagination', async () => {
    const response: MessagesResponse = { messages: [mockMessage], has_more: false };
    vi.mocked(api.get).mockResolvedValueOnce(response);

    const { result } = renderHook(() => useMessages('ch-1'), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data?.messages).toHaveLength(1);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/channels/ch-1/messages');
  });

  it('passes before + page_size as query params for keyset pagination', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ messages: [], has_more: false });

    const { result } = renderHook(
      () => useMessages('ch-1', { before: 'msg-99', page_size: 50 }),
      { wrapper: createWrapper(queryClient) },
    );
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/v1/channels/ch-1/messages?before=msg-99&page_size=50',
    );
  });

  it('does not fetch when channelId is empty', () => {
    const { result } = renderHook(() => useMessages(''), {
      wrapper: createWrapper(queryClient),
    });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useSendMessage', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('posts a message and invalidates messages + channels + unread caches', async () => {
    vi.mocked(api.post).mockResolvedValueOnce(mockMessage);

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useSendMessage(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({
      channelId: 'ch-1',
      input: { message_type: 'text', content: 'hi there' },
    });

    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data?.id).toBe('msg-1');
    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/channels/ch-1/messages',
      { message_type: 'text', content: 'hi there' },
    );
    // All four invalidations fire (messages list, channels list, single channel, unread).
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['messages', 'ch-1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['channels'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['channel', 'ch-1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['unread-count'] });
  });
});

describe('useMarkRead', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('posts to the read endpoint and invalidates unread/channel/channels caches', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ status: 'ok' });

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useMarkRead(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate('ch-1');

    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/channels/ch-1/read');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['unread-count'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['channel', 'ch-1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['channels'] });
  });
});

describe('useUnreadCount', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.resetAllMocks();
    authState.isAuthenticated = true;
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
    authState.isAuthenticated = true;
  });

  it('fetches the global unread count', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ total_unread: 7, channels: [] });

    const { result } = renderHook(() => useUnreadCount(), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data?.total_unread).toBe(7);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/channels/unread');
  });

  it('does not poll the unread endpoint while signed out', () => {
    authState.isAuthenticated = false;

    const { result } = renderHook(() => useUnreadCount(), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });
});
