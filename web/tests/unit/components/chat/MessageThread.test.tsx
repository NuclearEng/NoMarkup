import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom does not implement scrollIntoView — provide a no-op shim.
beforeAll(() => {
  Element.prototype.scrollIntoView = function () { /* noop */ };
});

const markReadMutate = vi.fn(() => Promise.resolve({}));

vi.mock('@/hooks/useChannels', () => ({
  useMessages: vi.fn(),
  useMarkRead: () => ({ mutateAsync: markReadMutate, isPending: false }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: vi.fn(),
}));

import { MessageThread } from '@/components/chat/MessageThread';
import { useMessages } from '@/hooks/useChannels';
import { useAuthStore } from '@/stores/auth-store';
import type { ChatMessage } from '@/types';
import { MESSAGE_TYPE, USER_ROLE, USER_STATUS } from '@/types';

const me = {
  id: 'user-me',
  email: 'me@example.com',
  displayName: 'Me',
  avatarUrl: null,
  roles: [USER_ROLE.CUSTOMER],
  status: USER_STATUS.ACTIVE,
  emailVerified: true,
  phoneVerified: false,
  mfaEnabled: false,
  createdAt: '2026-01-01T00:00:00Z',
};

function mockAuth(user: typeof me | null = me): void {
  vi.mocked(useAuthStore).mockImplementation(((selector: unknown) => {
    const state = { user } as unknown;
    return (selector as (s: unknown) => unknown)(state);
  }) as unknown as typeof useAuthStore);
}

function makeMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-default',
    channel_id: 'chan-1',
    sender_id: 'user-other',
    message_type: MESSAGE_TYPE.TEXT,
    content: 'Hello there!',
    flagged_contact_info: false,
    is_deleted: false,
    created_at: '2026-04-01T11:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  mockAuth();
  markReadMutate.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

const sampleMessages: ChatMessage[] = [
  makeMsg({ id: 'msg-1' }),
  makeMsg({
    id: 'msg-2',
    sender_id: 'user-me',
    content: 'Hi back!',
    created_at: '2026-04-01T11:05:00Z',
  }),
];

function setMessages(data: { messages: ChatMessage[]; has_more: boolean } | undefined, opts: { isLoading?: boolean; isError?: boolean } = {}): void {
  vi.mocked(useMessages).mockReturnValue({
    data,
    isLoading: opts.isLoading ?? false,
    isError: opts.isError ?? false,
  } as unknown as ReturnType<typeof useMessages>);
}

describe('MessageThread', () => {
  it('renders loading state initially', () => {
    setMessages(undefined, { isLoading: true });
    render(<MessageThread channelId="chan-1" />);
    expect(screen.getByText('Loading messages')).toBeDefined();
  });

  it('renders error state when request fails', () => {
    setMessages(undefined, { isError: true });
    render(<MessageThread channelId="chan-1" />);
    expect(screen.getByText('Failed to load messages.')).toBeDefined();
  });

  it('renders empty state when there are no messages', () => {
    setMessages({ messages: [], has_more: false });
    render(<MessageThread channelId="chan-1" />);
    expect(screen.getByText(/No messages yet/)).toBeDefined();
  });

  it('renders message contents in the log region', () => {
    setMessages({ messages: sampleMessages, has_more: false });
    render(<MessageThread channelId="chan-1" />);
    expect(screen.getByText('Hello there!')).toBeDefined();
    expect(screen.getByText('Hi back!')).toBeDefined();
    expect(screen.getByRole('log')).toBeDefined();
  });

  it('shows a Load older messages button when has_more is true', () => {
    setMessages({ messages: sampleMessages, has_more: true });
    render(<MessageThread channelId="chan-1" />);
    expect(screen.getByText('Load older messages')).toBeDefined();
  });

  it('marks the channel read when mounted', () => {
    setMessages({ messages: sampleMessages, has_more: false });
    render(<MessageThread channelId="chan-42" />);
    expect(markReadMutate).toHaveBeenCalledWith('chan-42');
  });

  it('renders a deleted message placeholder for is_deleted messages', () => {
    setMessages({
      messages: [makeMsg({ id: 'd-1', is_deleted: true, content: 'redacted-original' })],
      has_more: false,
    });
    render(<MessageThread channelId="chan-1" />);
    expect(screen.getByText('This message was deleted')).toBeDefined();
    expect(screen.queryByText('redacted-original')).toBeNull();
  });

  it('renders a system message as a centered pill', () => {
    setMessages({
      messages: [
        makeMsg({ id: 'sys-1', message_type: MESSAGE_TYPE.SYSTEM, content: 'Provider joined' }),
      ],
      has_more: false,
    });
    render(<MessageThread channelId="chan-1" />);
    expect(screen.getByText('Provider joined')).toBeDefined();
  });

  it('renders a flagged-contact-info indicator', () => {
    setMessages({
      messages: [makeMsg({ id: 'f-1', flagged_contact_info: true })],
      has_more: false,
    });
    render(<MessageThread channelId="chan-1" />);
    expect(screen.getAllByText(/May contain contact information/i).length).toBeGreaterThan(0);
  });

  it('parses and renders proposed-terms cards', () => {
    const termsContent = [
      '[Proposed Terms]',
      'Payment Type: milestone',
      'Amount: $1,500',
      'Milestones:',
      'Demo - $500',
      'Final - $1000',
      'Description: Roof patch and cleanup',
    ].join('\n');
    setMessages({
      messages: [makeMsg({ id: 't-1', content: termsContent })],
      has_more: false,
    });
    render(<MessageThread channelId="chan-1" />);
    expect(screen.getByText(/Proposed Terms/)).toBeDefined();
    expect(screen.getByText(/\$1,500/)).toBeDefined();
    expect(screen.getByText(/Roof patch and cleanup/)).toBeDefined();
    expect(screen.getByText('Demo - $500')).toBeDefined();
  });

  it('inserts a date separator between messages from different days', () => {
    setMessages({
      messages: [
        makeMsg({ id: 'a', created_at: '2026-03-30T11:00:00Z' }),
        makeMsg({ id: 'b', created_at: '2026-04-01T11:00:00Z' }),
      ],
      has_more: false,
    });
    render(<MessageThread channelId="chan-1" />);
    const seps = screen.getAllByRole('separator');
    expect(seps.length).toBeGreaterThanOrEqual(2);
  });

  it('clicking Load older messages updates the cursor and re-queries', () => {
    const useMessagesMock = vi.mocked(useMessages);
    setMessages({ messages: sampleMessages, has_more: true });
    render(<MessageThread channelId="chan-1" />);
    fireEvent.click(screen.getByText('Load older messages'));
    const calls = useMessagesMock.mock.calls;
    const lastCall = calls.at(-1);
    expect(lastCall).toBeDefined();
    if (lastCall) {
      expect(lastCall[0]).toBe('chan-1');
      const opts = lastCall[1] as { before?: string } | undefined;
      expect(opts?.before).toBe('msg-1');
    }
  });

  it('still renders messages when there is no user', () => {
    mockAuth(null);
    setMessages({ messages: sampleMessages, has_more: false });
    render(<MessageThread channelId="chan-1" />);
    expect(screen.getByText('Hello there!')).toBeDefined();
  });

  it('renders the Today separator label for messages from today', () => {
    const today = new Date().toISOString();
    setMessages({
      messages: [makeMsg({ id: 'today-1', created_at: today })],
      has_more: false,
    });
    render(<MessageThread channelId="chan-1" />);
    expect(screen.getByText('Today')).toBeDefined();
  });

  it('renders the Yesterday separator label for messages from yesterday', () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    setMessages({
      messages: [makeMsg({ id: 'y-1', created_at: yesterday })],
      has_more: false,
    });
    render(<MessageThread channelId="chan-1" />);
    expect(screen.getByText('Yesterday')).toBeDefined();
  });

  it('renders a read-receipt indicator on own messages followed by other messages', () => {
    setMessages({
      messages: [
        makeMsg({ id: 'a', sender_id: 'user-other' }),
        makeMsg({ id: 'b', sender_id: 'user-me', content: 'mine' }),
        makeMsg({ id: 'c', sender_id: 'user-other', created_at: '2026-04-01T11:10:00Z' }),
      ],
      has_more: false,
    });
    render(<MessageThread channelId="chan-1" />);
    expect(screen.getAllByLabelText(/Message read|Message sent/).length).toBeGreaterThan(0);
  });
});
