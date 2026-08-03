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
  useSendProposedTerms,
  useRespondToTerms,
  useCreateChannel,
  useShareContact,
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

    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/v1/channels?page=2&per_page=25&page_size=25',
    );
  });

  it('appends q for server inbox search (FR-8.6)', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ channels: [], pagination: { totalCount: 0, page: 1, pageSize: 50, totalPages: 0, hasNext: false } });

    const { result } = renderHook(() => useChannels({ page: 1, per_page: 50, q: 'alice' }), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/v1/channels?page=1&per_page=50&page_size=50&q=alice',
    );
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

  it('passes q for in-thread server search (FR-8.6)', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ messages: [], has_more: false });

    const { result } = renderHook(
      () => useMessages('ch-1', { page_size: 50, q: 'scope' }),
      { wrapper: createWrapper(queryClient) },
    );
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/v1/channels/ch-1/messages?page_size=50&q=scope',
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

describe('useSendProposedTerms', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('posts to proposed-terms and invalidates message caches', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      ...mockMessage,
      id: 'terms-1',
      message_type: 'proposed_terms',
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useSendProposedTerms(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({
      channelId: 'ch-1',
      input: {
        payment_type: 'completion',
        amount: '$250.00',
        description: 'Scope',
      },
    });

    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/channels/ch-1/proposed-terms',
      {
        payment_type: 'completion',
        amount: '$250.00',
        milestones: '',
        description: 'Scope',
      },
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['messages', 'ch-1'] });
  });
});

describe('useRespondToTerms', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('posts accepted true to terms/respond and invalidates message caches', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      ...mockMessage,
      id: 'resp-1',
      message_type: 'terms_accepted',
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useRespondToTerms(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ channelId: 'ch-1', accepted: true });

    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/channels/ch-1/terms/respond',
      { accepted: true },
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['messages', 'ch-1'] });
  });

  it('posts accepted false to terms/respond for Reject', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      ...mockMessage,
      id: 'resp-2',
      message_type: 'terms_rejected',
    });

    const { result } = renderHook(() => useRespondToTerms(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ channelId: 'ch-1', accepted: false });

    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/channels/ch-1/terms/respond',
      { accepted: false },
    );
  });
});

describe('useCreateChannel', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('posts job_id + channel_type and returns the channel (FR-8.1)', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ channel: mockChannel });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreateChannel(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ job_id: 'job-1', channel_type: 'inquiry' });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data?.id).toBe('ch-1');
    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/channels', {
      job_id: 'job-1',
      channel_type: 'inquiry',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['channels'] });
  });
});

describe('useShareContact', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('posts phone/email to share-contact and invalidates messages (FR-8.8)', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      contact: { user_id: 'prov-1', phone: '555-0100', shared_at: '2026-04-25T00:00:00Z' },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useShareContact(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({
      channelId: 'ch-1',
      input: { phone: '555-0100', email: 'a@example.com' },
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/channels/ch-1/share-contact',
      { phone: '555-0100', email: 'a@example.com' },
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['messages', 'ch-1'] });
  });

  it('fails closed when both phone and email are empty', async () => {
    const { result } = renderHook(() => useShareContact(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ channelId: 'ch-1', input: { phone: '  ', email: '' } });
    await waitFor(() => { expect(result.current.isError).toBe(true); });

    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
  });
});
