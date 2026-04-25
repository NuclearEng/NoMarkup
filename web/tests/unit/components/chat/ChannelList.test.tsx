import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href, ...rest }, children),
}));

vi.mock('@/hooks/useChannels', () => ({
  useChannels: vi.fn(),
}));

vi.mock('@/stores/chat-store', () => ({
  useChatStore: vi.fn(),
}));

import { ChannelList } from '@/components/chat/ChannelList';
import { useChannels } from '@/hooks/useChannels';
import { useChatStore } from '@/stores/chat-store';
import type { Channel } from '@/types';
import { CHANNEL_STATUS, CHANNEL_TYPE } from '@/types';

const setActiveChannel = vi.fn();

function mockStore(activeId: string | null = null) {
  vi.mocked(useChatStore).mockImplementation(((selector: unknown) => {
    const state = { activeChannelId: activeId, setActiveChannel } as unknown;
    return (selector as (s: unknown) => unknown)(state);
  }) as unknown as typeof useChatStore);
}

const sampleChannel: Channel = {
  id: 'chan-1',
  job_id: 'job-1',
  customer_id: 'cust-alice',
  provider_id: 'prov-bob',
  status: CHANNEL_STATUS.ACTIVE,
  channel_type: CHANNEL_TYPE.PRE_AWARD,
  unread_count: 2,
  message_count: 4,
  created_at: '2026-04-01T10:00:00Z',
  updated_at: '2026-04-01T10:00:00Z',
  last_message: {
    id: 'msg-1',
    channel_id: 'chan-1',
    sender_id: 'cust-alice',
    message_type: 'text',
    content: 'Hi there!',
    flagged_contact_info: false,
    is_deleted: false,
    created_at: '2026-04-01T11:00:00Z',
  },
};

beforeEach(() => {
  mockStore(null);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ChannelList', () => {
  it('renders skeleton while loading', () => {
    vi.mocked(useChannels).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as unknown as ReturnType<typeof useChannels>);
    render(<ChannelList />);
    expect(screen.getByLabelText('Search conversations')).toBeDefined();
  });

  it('renders an empty state when no channels exist', () => {
    vi.mocked(useChannels).mockReturnValue({
      data: { channels: [], pagination: { page: 1, page_size: 50, total: 0 } },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useChannels>);
    render(<ChannelList />);
    expect(screen.getByText('No conversations yet')).toBeDefined();
  });

  it('renders an error state when the request fails', () => {
    vi.mocked(useChannels).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as unknown as ReturnType<typeof useChannels>);
    render(<ChannelList />);
    expect(screen.getByText('Failed to load conversations.')).toBeDefined();
  });

  it('renders a channel item with last message preview and unread badge', () => {
    vi.mocked(useChannels).mockReturnValue({
      data: { channels: [sampleChannel], pagination: { page: 1, page_size: 50, total: 1 } },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useChannels>);
    render(<ChannelList />);
    expect(screen.getByText('Hi there!')).toBeDefined();
    expect(screen.getByText('2')).toBeDefined();
    expect(screen.getByText('Pre-Award')).toBeDefined();
  });

  it('marks the active channel via aria-current', () => {
    mockStore('chan-1');
    vi.mocked(useChannels).mockReturnValue({
      data: { channels: [sampleChannel], pagination: { page: 1, page_size: 50, total: 1 } },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useChannels>);
    render(<ChannelList />);
    const button = screen.getByRole('button', { name: /Open conversation with prov-bob/ });
    expect(button.getAttribute('aria-current')).toBe('true');
  });
});
