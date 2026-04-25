// Smoke test for the messages (chat) page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

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
  MessageInput: () => createElement('div', { 'data-testid': 'message-input' }),
}));
vi.mock('@/components/chat/MessageThread', () => ({
  MessageThread: () => createElement('div', { 'data-testid': 'message-thread' }),
}));
vi.mock('@/components/chat/TypingIndicator', () => ({
  TypingIndicator: () => createElement('div', { 'data-testid': 'typing' }),
}));

vi.mock('@/hooks/useChannels', () => ({
  useChannel: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('@/stores/chat-store', () => ({
  useChatStore: (selector: (s: unknown) => unknown) =>
    selector({ activeChannelId: null, connectionStatus: 'disconnected' }),
}));

import MessagesPage from '@/app/(dashboard)/messages/page';

describe('MessagesPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(MessagesPage)));
    expect(container).toBeTruthy();
  });
});
