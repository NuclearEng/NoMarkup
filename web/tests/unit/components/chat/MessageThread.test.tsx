import { render, screen } from '@testing-library/react';
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

function mockAuth() {
  vi.mocked(useAuthStore).mockImplementation(((selector: unknown) => {
    const state = { user: me } as unknown;
    return (selector as (s: unknown) => unknown)(state);
  }) as unknown as typeof useAuthStore);
}

beforeEach(() => {
  mockAuth();
  markReadMutate.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

const sampleMessages: ChatMessage[] = [
  {
    id: 'msg-1',
    channel_id: 'chan-1',
    sender_id: 'user-other',
    message_type: MESSAGE_TYPE.TEXT,
    content: 'Hello there!',
    flagged_contact_info: false,
    is_deleted: false,
    created_at: '2026-04-01T11:00:00Z',
  },
  {
    id: 'msg-2',
    channel_id: 'chan-1',
    sender_id: 'user-me',
    message_type: MESSAGE_TYPE.TEXT,
    content: 'Hi back!',
    flagged_contact_info: false,
    is_deleted: false,
    created_at: '2026-04-01T11:05:00Z',
  },
];

describe('MessageThread', () => {
  it('renders loading state initially', () => {
    vi.mocked(useMessages).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as unknown as ReturnType<typeof useMessages>);
    render(<MessageThread channelId="chan-1" />);
    expect(screen.getByText('Loading messages')).toBeDefined();
  });

  it('renders error state when request fails', () => {
    vi.mocked(useMessages).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as unknown as ReturnType<typeof useMessages>);
    render(<MessageThread channelId="chan-1" />);
    expect(screen.getByText('Failed to load messages.')).toBeDefined();
  });

  it('renders empty state when there are no messages', () => {
    vi.mocked(useMessages).mockReturnValue({
      data: { messages: [], has_more: false },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useMessages>);
    render(<MessageThread channelId="chan-1" />);
    expect(screen.getByText(/No messages yet/)).toBeDefined();
  });

  it('renders message contents in the log region', () => {
    vi.mocked(useMessages).mockReturnValue({
      data: { messages: sampleMessages, has_more: false },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useMessages>);
    render(<MessageThread channelId="chan-1" />);
    expect(screen.getByText('Hello there!')).toBeDefined();
    expect(screen.getByText('Hi back!')).toBeDefined();
    expect(screen.getByRole('log')).toBeDefined();
  });

  it('shows a Load older messages button when has_more is true', () => {
    vi.mocked(useMessages).mockReturnValue({
      data: { messages: sampleMessages, has_more: true },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useMessages>);
    render(<MessageThread channelId="chan-1" />);
    expect(screen.getByText('Load older messages')).toBeDefined();
  });
});
