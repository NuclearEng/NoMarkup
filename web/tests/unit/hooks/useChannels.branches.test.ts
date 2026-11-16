// useChannels — branches useChannels.test.ts leaves untested: the explicit
// `enabled` override on useMessages (used to idle the search query), search
// term trimming/capping in URL and query key, body defaults for proposed terms
// and channel creation, the id-less created channel, the single-field
// share-contact bodies, and failure paths (no cache invalidation).
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useChannels,
  useCreateChannel,
  useMessages,
  useSendProposedTerms,
  useShareContact,
} from '@/hooks/useChannels';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const authState = { isAuthenticated: true, isHydrating: false };
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: <T,>(selector: (state: typeof authState) => T): T => selector(authState),
}));

const { api } = await import('@/lib/api');

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

let queryClient: QueryClient;

beforeEach(() => {
  vi.resetAllMocks();
  queryClient = createTestQueryClient();
});

afterEach(() => {
  queryClient.clear();
});

describe('useMessages enabled override', () => {
  it.each([
    { name: 'enabled=false idles the query even with a channel', channelId: 'ch-1', enabled: false },
    { name: 'enabled=true cannot force a fetch without a channel', channelId: '', enabled: true },
  ])('$name', ({ channelId, enabled }) => {
    const { result } = renderHook(() => useMessages(channelId, { q: 'invoice', enabled }), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });

  it('enabled=true with a channel fetches, trimming the search term in URL and key', async () => {
    const payload = { messages: [], has_more: false };
    vi.mocked(api.get).mockResolvedValueOnce(payload);

    const { result } = renderHook(
      () => useMessages('ch-1', { q: '  invoice total  ', page_size: 25, enabled: true }),
      { wrapper: createWrapper(queryClient) },
    );
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/v1/channels/ch-1/messages?page_size=25&q=invoice+total',
    );
    expect(
      queryClient.getQueryData(['messages', 'ch-1', undefined, 25, 'invoice total']),
    ).toEqual(payload);
  });

  it('a whitespace-only search term is dropped from the URL and keyed as no search', async () => {
    const payload = { messages: [], has_more: false };
    vi.mocked(api.get).mockResolvedValueOnce(payload);

    const { result } = renderHook(() => useMessages('ch-1', { q: '   ' }), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/channels/ch-1/messages');
    expect(
      queryClient.getQueryData(['messages', 'ch-1', undefined, undefined, undefined]),
    ).toEqual(payload);
  });

  it('caps the search term at 200 characters on the wire', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ messages: [] });
    const long = 'a'.repeat(250);

    const { result } = renderHook(() => useMessages('ch-1', { q: long }), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      `/api/v1/channels/ch-1/messages?q=${'a'.repeat(200)}`,
    );
  });
});

describe('useChannels search + paging', () => {
  it('sends per_page under both names and caps the inbox search at 200 characters', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ channels: [] });
    const long = 'b'.repeat(210);

    const { result } = renderHook(() => useChannels({ page: 0, per_page: 10, q: ` ${long} ` }), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // page 0 is a real value, not "absent".
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      `/api/v1/channels?page=0&per_page=10&page_size=10&q=${'b'.repeat(200)}`,
    );
    expect(queryClient.getQueryData(['channels', 0, 10, long])).toEqual({ channels: [] });
  });

  it('keeps the previous inbox page on screen while a new search loads', async () => {
    const firstPage = { channels: [{ id: 'ch-1' }] };
    vi.mocked(api.get)
      .mockResolvedValueOnce(firstPage)
      .mockReturnValueOnce(new Promise(() => undefined));

    const { result, rerender } = renderHook(({ q }: { q: string }) => useChannels({ q }), {
      wrapper: createWrapper(queryClient),
      initialProps: { q: '' },
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    rerender({ q: 'plumber' });

    expect(vi.mocked(api.get)).toHaveBeenLastCalledWith('/api/v1/channels?q=plumber');
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data).toEqual(firstPage);
  });
});

describe('useSendProposedTerms', () => {
  it('defaults omitted milestones and description to empty strings', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ id: 'msg-1' });

    const { result } = renderHook(() => useSendProposedTerms(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({ channelId: 'ch-1', input: { payment_type: 'fixed', amount: '250.00' } });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/channels/ch-1/proposed-terms', {
      payment_type: 'fixed',
      amount: '250.00',
      milestones: '',
      description: '',
    });
  });

  it('invalidates nothing when the server rejects the proposal', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('403 provider only'));
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useSendProposedTerms(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({ channelId: 'ch-1', input: { payment_type: 'fixed', amount: '1' } });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe('useCreateChannel', () => {
  it('defaults channel_type to inquiry and refreshes the new channel', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ channel: { id: 'ch-new' } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreateChannel(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({ job_id: 'job-1' });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/channels', {
      job_id: 'job-1',
      channel_type: 'inquiry',
    });
    expect(result.current.data).toEqual({ id: 'ch-new' });
    expect(invalidateSpy.mock.calls.map(([f]) => f?.queryKey)).toEqual([
      ['channels'],
      ['channel', 'ch-new'],
      ['unread-count'],
    ]);
  });

  it('does not invalidate a ["channel", ""] key when the response has no id', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ channel: { id: '' } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreateChannel(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({ job_id: 'job-1', channel_type: 'bid' });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/channels', {
      job_id: 'job-1',
      channel_type: 'bid',
    });
    expect(invalidateSpy.mock.calls.map(([f]) => f?.queryKey)).toEqual([
      ['channels'],
      ['unread-count'],
    ]);
  });
});

describe('useShareContact body shape', () => {
  interface ShareCase {
    name: string;
    input: { phone?: string; email?: string };
    body: Record<string, string>;
  }

  const CASES: ShareCase[] = [
    { name: 'phone only (email key omitted)', input: { phone: ' 555-0100 ' }, body: { phone: '555-0100' } },
    {
      name: 'email only (phone key omitted)',
      input: { email: ' a@example.com ' },
      body: { email: 'a@example.com' },
    },
    {
      name: 'blank phone is dropped, email kept',
      input: { phone: '   ', email: 'a@example.com' },
      body: { email: 'a@example.com' },
    },
  ];

  it.each(CASES)('$name', async ({ input, body }) => {
    const contact = { user_id: 'prov-1', ...body };
    vi.mocked(api.post).mockResolvedValueOnce({ contact });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useShareContact(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({ channelId: 'ch-1', input });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // toStrictEqual: the omitted field must be absent, not undefined.
    expect(vi.mocked(api.post).mock.calls[0]).toStrictEqual([
      '/api/v1/channels/ch-1/share-contact',
      body,
    ]);
    expect(result.current.data).toEqual(contact);
    // Sharing contact is not a new unread message: unread-count is untouched.
    expect(invalidateSpy.mock.calls.map(([f]) => f?.queryKey)).toEqual([
      ['messages', 'ch-1'],
      ['channels'],
      ['channel', 'ch-1'],
    ]);
  });

  it('fails closed with a clear error when neither field is supplied at all', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useShareContact(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({ channelId: 'ch-1', input: {} });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toEqual(new Error('Phone or email is required'));
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
