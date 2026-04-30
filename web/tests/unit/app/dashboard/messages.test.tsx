// Tests for the messages (chat) page — covers the no-channel state, the
// active-channel branch (which renders the thread + input + typing indicator),
// the mobile back button, and connection status indicators.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const chatStoreState: {
  activeChannelId: string | null;
  connectionStatus: string;
  setActiveChannel: (id: string | null) => void;
} = {
  activeChannelId: null,
  connectionStatus: 'disconnected',
  setActiveChannel: vi.fn(),
};

const channelState: { data: { channel: { status: string } } | undefined } = {
  data: undefined,
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/messages',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/components/chat/ChannelList', () => ({
  ChannelList: () => createElement('div', { 'data-testid': 'channel-list' }),
}));
vi.mock('@/components/chat/MessageInput', () => ({
  MessageInput: ({ channelStatus }: { channelStatus: string }) =>
    createElement(
      'div',
      { 'data-testid': 'message-input', 'data-channel-status': channelStatus },
    ),
}));
vi.mock('@/components/chat/MessageThread', () => ({
  MessageThread: ({ channelId }: { channelId: string }) =>
    createElement('div', { 'data-testid': 'message-thread', 'data-channel-id': channelId }),
}));
vi.mock('@/components/chat/TypingIndicator', () => ({
  TypingIndicator: () => createElement('div', { 'data-testid': 'typing' }),
}));

// New (Wave 5 / Agent P) — relay banner + block button mounted by
// ActiveThread. Stub them out so this page-level test stays focused on
// layout and channel routing.
vi.mock('@/components/chat/RelayBanner', () => ({
  RelayBanner: () => createElement('div', { 'data-testid': 'relay-banner' }),
}));
vi.mock('@/components/chat/BlockButton', () => ({
  BlockButton: () => createElement('div', { 'data-testid': 'block-button' }),
}));

vi.mock('@/hooks/useChannels', () => ({
  useChannel: () => channelState,
}));

vi.mock('@/hooks/useUserBlocks', () => ({
  useMyBlocks: () => ({ data: { blocks: [], pagination: {} } }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { id: 'me-1' } }),
}));

vi.mock('@/stores/chat-store', () => ({
  useChatStore: (selector: (s: unknown) => unknown) =>
    selector({
      activeChannelId: chatStoreState.activeChannelId,
      connectionStatus: chatStoreState.connectionStatus,
      setActiveChannel: chatStoreState.setActiveChannel,
    }),
}));

const { default: MessagesPage } = await import('@/app/(dashboard)/messages/page');

beforeEach(() => {
  chatStoreState.activeChannelId = null;
  chatStoreState.connectionStatus = 'disconnected';
  chatStoreState.setActiveChannel = vi.fn();
  channelState.data = undefined;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('MessagesPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(MessagesPage)));
    expect(container).toBeTruthy();
  });

  it('shows the Messages heading and description', () => {
    render(withQueryClient(createElement(MessagesPage)));
    expect(screen.getByRole('heading', { name: 'Messages' })).toBeDefined();
    expect(screen.getByText(/Communicate with customers and providers/i)).toBeDefined();
  });

  it('renders the channel list sidebar', () => {
    render(withQueryClient(createElement(MessagesPage)));
    expect(screen.getByTestId('channel-list')).toBeDefined();
  });

  it('shows the no-conversation empty state when no channel is selected', () => {
    render(withQueryClient(createElement(MessagesPage)));
    expect(screen.getByText('Select a conversation')).toBeDefined();
  });

  it('renders the active thread, typing indicator, and message input when a channel is active', () => {
    chatStoreState.activeChannelId = 'channel-42';
    channelState.data = { channel: { status: 'active' } };
    render(withQueryClient(createElement(MessagesPage)));
    const thread = screen.getByTestId('message-thread');
    expect(thread.getAttribute('data-channel-id')).toBe('channel-42');
    expect(screen.getByTestId('typing')).toBeDefined();
    const input = screen.getByTestId('message-input');
    expect(input.getAttribute('data-channel-status')).toBe('active');
    // No conversation empty state should NOT render alongside the active thread.
    expect(screen.queryByText('Select a conversation')).toBeNull();
  });

  it('forwards the channel status to the MessageInput when the channel hook returns data', () => {
    chatStoreState.activeChannelId = 'c1';
    channelState.data = { channel: { status: 'closed' } };
    render(withQueryClient(createElement(MessagesPage)));
    expect(
      screen.getByTestId('message-input').getAttribute('data-channel-status'),
    ).toBe('closed');
  });

  it('falls back to "active" channel status when useChannel returns no data', () => {
    chatStoreState.activeChannelId = 'c1';
    channelState.data = undefined;
    render(withQueryClient(createElement(MessagesPage)));
    expect(
      screen.getByTestId('message-input').getAttribute('data-channel-status'),
    ).toBe('active');
  });

  it('clicking the mobile back button calls setActiveChannel(null)', () => {
    chatStoreState.activeChannelId = 'c1';
    render(withQueryClient(createElement(MessagesPage)));
    fireEvent.click(screen.getByRole('button', { name: /Back to conversations/i }));
    expect(chatStoreState.setActiveChannel).toHaveBeenCalledWith(null);
  });

  it('renders the connecting indicator dot in yellow', () => {
    chatStoreState.connectionStatus = 'connecting';
    render(withQueryClient(createElement(MessagesPage)));
    // The status dot is a span with bg-yellow-500 when connecting.
    const dot = document.querySelector('.bg-yellow-500');
    expect(dot).not.toBeNull();
  });

  it('renders the connected indicator dot in green', () => {
    chatStoreState.connectionStatus = 'connected';
    render(withQueryClient(createElement(MessagesPage)));
    expect(document.querySelector('.bg-green-500')).not.toBeNull();
  });

  it('renders the disconnected indicator dot in red', () => {
    chatStoreState.connectionStatus = 'disconnected';
    render(withQueryClient(createElement(MessagesPage)));
    expect(document.querySelector('.bg-red-500')).not.toBeNull();
  });

  it('falls back to a gray indicator for unknown connection statuses', () => {
    chatStoreState.connectionStatus = 'reconnecting-soonish';
    render(withQueryClient(createElement(MessagesPage)));
    expect(document.querySelector('.bg-gray-400')).not.toBeNull();
    // Unknown label rendered in the sr-only span.
    expect(screen.getByText('Unknown')).toBeDefined();
  });
});
