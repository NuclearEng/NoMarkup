// Branch tests for the messages page beyond messages.test.tsx: the
// `?channel=` deep link (UUID guard), which party is treated as "the other
// side", the display-name fallback, the provider-only Propose Terms gate, and
// the blocked flag handed to the header actions.
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ChannelData {
  channel: {
    status: string;
    customer_id: string;
    provider_id: string;
    customer_name?: string | null;
    provider_name?: string | null;
  };
}

const h = vi.hoisted(() => ({
  search: '',
  activeChannelId: null as string | null,
  setActiveChannel: vi.fn<(id: string | null) => void>(),
  channel: undefined as unknown,
  channelArgs: [] as string[],
  me: null as { id: string } | null,
  blocks: undefined as { blocks: { blocked_id: string }[] } | undefined,
  props: {} as Record<string, unknown>,
}));

function capture(name: string) {
  return (props: unknown) => {
    h.props[name] = props;
    return createElement('div', { 'data-testid': name });
  };
}

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(h.search),
}));

vi.mock('@/components/chat/ChannelList', () => ({ ChannelList: capture('channel-list') }));
vi.mock('@/components/chat/MessageInput', () => ({ MessageInput: capture('message-input') }));
vi.mock('@/components/chat/MessageThread', () => ({ MessageThread: capture('message-thread') }));
vi.mock('@/components/chat/TypingIndicator', () => ({ TypingIndicator: capture('typing') }));
vi.mock('@/components/chat/RelayBanner', () => ({ RelayBanner: capture('relay-banner') }));
vi.mock('@/components/chat/BlockButton', () => ({ BlockButton: capture('block-button') }));
vi.mock('@/components/chat/ShareContactButton', () => ({
  ShareContactButton: capture('share-contact'),
}));
vi.mock('@/components/chat/ReportButton', () => ({ ReportButton: capture('report-button') }));

vi.mock('@/hooks/useChannels', () => ({
  useChannel: (channelId: string) => {
    h.channelArgs.push(channelId);
    return { data: h.channel };
  },
}));

vi.mock('@/hooks/useUserBlocks', () => ({
  useMyBlocks: () => ({ data: h.blocks }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: h.me }),
}));

vi.mock('@/stores/chat-store', () => ({
  useChatStore: (
    selector: (s: {
      activeChannelId: string | null;
      connectionStatus: string;
      setActiveChannel: (id: string | null) => void;
    }) => unknown,
  ) =>
    selector({
      activeChannelId: h.activeChannelId,
      connectionStatus: 'connected',
      setActiveChannel: h.setActiveChannel,
    }),
}));

const { default: MessagesPage } = await import('@/app/(dashboard)/messages/page');

const CHANNEL_ID = '0b8f6c1e-2a3d-4e5f-8a9b-0c1d2e3f4a5b';
const CUSTOMER = 'cust-1';
const PROVIDER = 'prov-1';

function channel(overrides: Partial<ChannelData['channel']> = {}): ChannelData {
  return {
    channel: {
      status: 'active',
      customer_id: CUSTOMER,
      provider_id: PROVIDER,
      customer_name: 'Casey Customer',
      provider_name: 'Ace Plumbing',
      ...overrides,
    },
  };
}

function renderPage() {
  return render(createElement(MessagesPage));
}

beforeEach(() => {
  h.search = '';
  h.activeChannelId = null;
  h.setActiveChannel.mockReset();
  h.channel = undefined;
  h.channelArgs.length = 0;
  h.me = { id: CUSTOMER };
  h.blocks = { blocks: [] };
  h.props = {};
});

describe('MessagesPage — ?channel= deep link', () => {
  it('opens the thread for a valid channel UUID', () => {
    h.search = `channel=${CHANNEL_ID}`;
    renderPage();
    expect(h.setActiveChannel).toHaveBeenCalledTimes(1);
    expect(h.setActiveChannel).toHaveBeenCalledWith(CHANNEL_ID);
  });

  it('trims surrounding whitespace and accepts upper-case hex', () => {
    h.search = `channel=%20${CHANNEL_ID.toUpperCase()}%20`;
    renderPage();
    expect(h.setActiveChannel).toHaveBeenCalledWith(CHANNEL_ID.toUpperCase());
  });

  it.each([
    ['no channel param', ''],
    ['an empty channel param', 'channel='],
    ['a whitespace-only channel param', 'channel=%20%20'],
    ['a non-UUID id', 'channel=channel-42'],
    ['a UUID with an invalid version nibble', 'channel=0b8f6c1e-2a3d-0e5f-8a9b-0c1d2e3f4a5b'],
    ['a UUID with trailing junk', `channel=${CHANNEL_ID}%27--`],
    ['a script payload', 'channel=%3Cscript%3Ealert(1)%3C%2Fscript%3E'],
  ])('ignores %s', (_label, search) => {
    h.search = search;
    renderPage();
    expect(h.setActiveChannel).not.toHaveBeenCalled();
    expect(screen.getByText('Select a conversation')).toBeInTheDocument();
  });
});

describe('MessagesPage — active thread header', () => {
  beforeEach(() => {
    h.activeChannelId = CHANNEL_ID;
  });

  it('treats the provider as the other party when the customer is signed in', () => {
    h.channel = channel();
    renderPage();
    expect(h.channelArgs.at(-1)).toBe(CHANNEL_ID);
    expect(screen.getByText('Ace Plumbing')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(h.props['share-contact']).toEqual({ channelId: CHANNEL_ID });
    expect(h.props['report-button']).toEqual({
      userId: PROVIDER,
      displayName: 'Ace Plumbing',
      channelId: CHANNEL_ID,
    });
    expect(h.props['block-button']).toEqual({ userId: PROVIDER, isBlocked: false });
    expect(h.props['typing']).toEqual({ channelId: CHANNEL_ID, otherPartyName: 'Ace Plumbing' });
    // A customer cannot propose terms.
    expect(h.props['message-input']).toEqual({
      channelId: CHANNEL_ID,
      channelStatus: 'active',
      canProposeTerms: false,
    });
  });

  it('treats the customer as the other party and unlocks Propose Terms for the provider', () => {
    h.me = { id: PROVIDER };
    h.channel = channel({ status: 'closed' });
    renderPage();
    expect(screen.getByText('Casey Customer')).toBeInTheDocument();
    expect(h.props['report-button']).toMatchObject({ userId: CUSTOMER, displayName: 'Casey Customer' });
    expect(h.props['block-button']).toEqual({ userId: CUSTOMER, isBlocked: false });
    expect(h.props['message-input']).toEqual({
      channelId: CHANNEL_ID,
      channelStatus: 'closed',
      canProposeTerms: true,
    });
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['blank', '   '],
  ])('falls back to "Conversation" — never an id — when the name is %s', (_label, providerName) => {
    h.channel = channel({ provider_name: providerName });
    renderPage();
    expect(screen.getByText('Conversation')).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
    expect(screen.queryByText(PROVIDER)).not.toBeInTheDocument();
    expect(h.props['report-button']).toMatchObject({ displayName: 'Conversation' });
  });

  it('flags the other party as blocked only when they are in my block list', () => {
    h.channel = channel();
    h.blocks = { blocks: [{ blocked_id: 'someone-else' }, { blocked_id: PROVIDER }] };
    const view = renderPage();
    expect(h.props['block-button']).toEqual({ userId: PROVIDER, isBlocked: true });

    h.blocks = { blocks: [{ blocked_id: 'someone-else' }] };
    view.rerender(createElement(MessagesPage));
    expect(h.props['block-button']).toEqual({ userId: PROVIDER, isBlocked: false });
  });

  it('treats an unloaded block list as not blocked', () => {
    h.channel = channel();
    h.blocks = undefined;
    renderPage();
    expect(h.props['block-button']).toEqual({ userId: PROVIDER, isBlocked: false });
  });

  it('hides the header actions while the channel is still loading', () => {
    h.channel = undefined;
    renderPage();
    expect(screen.queryByTestId('block-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('report-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('share-contact')).not.toBeInTheDocument();
    // The thread itself still mounts against the selected channel.
    expect(h.props['message-thread']).toEqual({ channelId: CHANNEL_ID });
    expect(h.props['typing']).toEqual({ channelId: CHANNEL_ID, otherPartyName: null });
    expect(h.props['message-input']).toEqual({
      channelId: CHANNEL_ID,
      channelStatus: 'active',
      canProposeTerms: false,
    });
  });

  it('hides the header actions and Propose Terms when no user is signed in', () => {
    h.me = null;
    h.channel = channel();
    renderPage();
    expect(screen.queryByTestId('block-button')).not.toBeInTheDocument();
    expect(h.props['typing']).toEqual({ channelId: CHANNEL_ID, otherPartyName: null });
    expect(h.props['message-input']).toMatchObject({ canProposeTerms: false });
  });

  it('hides the header when the counterparty id is redacted', () => {
    h.channel = channel({ provider_id: '' });
    renderPage();
    expect(screen.queryByTestId('block-button')).not.toBeInTheDocument();
    expect(h.props['message-input']).toMatchObject({ canProposeTerms: false });
  });

  it('hides the channel list on mobile while a thread is open, and the thread when none is', () => {
    h.channel = channel();
    const view = renderPage();
    expect(screen.getByTestId('channel-list').parentElement).toHaveClass('hidden', 'md:block');
    expect(screen.getByRole('button', { name: 'Back to conversations' })).toBeInTheDocument();

    h.activeChannelId = null;
    view.rerender(createElement(MessagesPage));
    const listPane = screen.getByTestId('channel-list').parentElement;
    expect(listPane).toHaveClass('block');
    expect(listPane).not.toHaveClass('hidden');
    expect(screen.queryByRole('button', { name: 'Back to conversations' })).not.toBeInTheDocument();
  });
});
