import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom does not implement scrollIntoView — install a spy so we can assert the
// thread scrolls the newest message into view on send/new-message.
const scrollIntoViewSpy = vi.fn();
beforeAll(() => {
  Element.prototype.scrollIntoView = scrollIntoViewSpy;
  // jsdom returns 0 for layout metrics; that makes the near-bottom check read
  // "at bottom" by default, which is the realistic state right after open.
});

const markReadMutate = vi.fn(() => Promise.resolve({}));
const respondToTermsMutate = vi.fn(() => Promise.resolve({ id: 'terms-resp-1' }));

const channelFixture = {
  customer_id: 'user-me',
  provider_id: 'prov-1',
  customer_name: 'Jane Customer',
  provider_name: 'Mike Provider',
  status: 'active',
  customer_last_read_at: undefined as string | undefined,
  provider_last_read_at: undefined as string | undefined,
};

vi.mock('@/hooks/useChannels', () => ({
  useMessages: vi.fn(),
  useMarkRead: () => ({ mutateAsync: markReadMutate, isPending: false }),
  useRespondToTerms: () => ({
    mutateAsync: respondToTermsMutate,
    isPending: false,
  }),
  // MessageThread reads the channel to resolve sender display names for bubbles
  // and to decide customer-only Accept/Reject for proposed terms + peer Seen.
  useChannel: () => ({
    data: {
      channel: channelFixture,
    },
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
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
  respondToTermsMutate.mockClear();
  respondToTermsMutate.mockImplementation(() => Promise.resolve({ id: 'terms-resp-1' }));
  scrollIntoViewSpy.mockClear();
  channelFixture.customer_last_read_at = undefined;
  channelFixture.provider_last_read_at = undefined;
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

  it('shows Accept/Reject on the latest open proposal for the channel customer', () => {
    const termsContent = [
      '[Proposed Terms]',
      'Payment Type: completion',
      'Amount: $900',
      'Description: Gutters',
    ].join('\n');
    setMessages({
      messages: [
        makeMsg({
          id: 't-open',
          sender_id: 'prov-1',
          content: termsContent,
          message_type: MESSAGE_TYPE.PROPOSED_TERMS,
        }),
      ],
      has_more: false,
    });
    render(<MessageThread channelId="chan-1" />);
    expect(screen.getByLabelText('Accept proposed terms')).toBeDefined();
    expect(screen.getByLabelText('Reject proposed terms')).toBeDefined();
  });

  it('hides Accept/Reject after a later terms_accepted message', () => {
    const termsContent = [
      '[Proposed Terms]',
      'Payment Type: completion',
      'Amount: $900',
      'Description: Gutters',
    ].join('\n');
    setMessages({
      messages: [
        makeMsg({
          id: 't-old',
          sender_id: 'prov-1',
          content: termsContent,
          message_type: MESSAGE_TYPE.PROPOSED_TERMS,
          created_at: '2026-04-01T11:00:00Z',
        }),
        makeMsg({
          id: 't-acc',
          sender_id: 'user-me',
          content: 'Customer accepted the proposed terms.',
          message_type: MESSAGE_TYPE.TERMS_ACCEPTED,
          created_at: '2026-04-01T11:05:00Z',
        }),
      ],
      has_more: false,
    });
    render(<MessageThread channelId="chan-1" />);
    expect(screen.queryByLabelText('Accept proposed terms')).toBeNull();
    expect(screen.getByText(/Customer accepted the proposed terms/)).toBeDefined();
  });

  it('posts terms/respond with accepted:true when customer Accepts', async () => {
    const termsContent = [
      '[Proposed Terms]',
      'Payment Type: completion',
      'Amount: $900',
      'Description: Gutters',
    ].join('\n');
    setMessages({
      messages: [
        makeMsg({
          id: 't-open',
          sender_id: 'prov-1',
          content: termsContent,
          message_type: MESSAGE_TYPE.PROPOSED_TERMS,
        }),
      ],
      has_more: false,
    });
    render(<MessageThread channelId="chan-1" />);
    fireEvent.click(screen.getByLabelText('Accept proposed terms'));
    await waitFor(() => {
      expect(respondToTermsMutate).toHaveBeenCalledWith({
        channelId: 'chan-1',
        accepted: true,
      });
    });
  });

  it('posts terms/respond with accepted:false when customer Rejects', async () => {
    const termsContent = [
      '[Proposed Terms]',
      'Payment Type: completion',
      'Amount: $900',
      'Description: Gutters',
    ].join('\n');
    setMessages({
      messages: [
        makeMsg({
          id: 't-open',
          sender_id: 'prov-1',
          content: termsContent,
          message_type: MESSAGE_TYPE.PROPOSED_TERMS,
        }),
      ],
      has_more: false,
    });
    render(<MessageThread channelId="chan-1" />);
    fireEvent.click(screen.getByLabelText('Reject proposed terms'));
    await waitFor(() => {
      expect(respondToTermsMutate).toHaveBeenCalledWith({
        channelId: 'chan-1',
        accepted: false,
      });
    });
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

  it('renders a Seen receipt on last own message followed by a peer reply', () => {
    setMessages({
      messages: [
        makeMsg({ id: 'a', sender_id: 'user-other' }),
        makeMsg({ id: 'b', sender_id: 'user-me', content: 'mine' }),
        makeMsg({ id: 'c', sender_id: 'user-other', created_at: '2026-04-01T11:10:00Z' }),
      ],
      has_more: false,
    });
    render(<MessageThread channelId="chan-1" />);
    expect(screen.getByLabelText('Message seen')).toBeDefined();
    expect(screen.getByTitle('Seen')).toBeDefined();
  });

  // ---- WAVE 21 BRANCH-DEEPENING ----

  it('renders the "Sent" receipt for last own message with no peer watermark or reply', () => {
    setMessages({
      messages: [
        makeMsg({ id: 'only-mine', sender_id: 'user-me', content: 'first message' }),
      ],
      has_more: false,
    });
    render(<MessageThread channelId="chan-1" />);
    expect(screen.getByLabelText('Message sent')).toBeDefined();
    expect(screen.getByTitle('Sent')).toBeDefined();
  });

  it('renders Seen from peer last_read watermark without a peer reply', () => {
    // Viewer is customer → peer watermark is provider_last_read_at.
    channelFixture.provider_last_read_at = '2026-04-01T12:00:00Z';
    setMessages({
      messages: [
        makeMsg({
          id: 'only-mine',
          sender_id: 'user-me',
          content: 'first message',
          created_at: '2026-04-01T11:00:00Z',
        }),
      ],
      has_more: false,
    });
    render(<MessageThread channelId="chan-1" />);
    expect(screen.getByLabelText('Message seen')).toBeDefined();
    expect(screen.getByTitle('Seen')).toBeDefined();
  });

  it('renders own-message styling for a deleted own message', () => {
    setMessages({
      messages: [
        makeMsg({
          id: 'mine-deleted',
          sender_id: 'user-me',
          is_deleted: true,
          content: 'gone',
        }),
      ],
      has_more: false,
    });
    const { container } = render(<MessageThread channelId="chan-1" />);
    expect(screen.getByText('This message was deleted')).toBeDefined();
    // Own deleted message bubble uses bg-primary styling.
    expect(container.querySelector('.bg-primary')).not.toBeNull();
  });

  it('renders the loading spinner inside the Load older messages button while loading more', () => {
    // Once beforeCursor is set (after a Load Older click), the full-page loader
    // is skipped — the button itself shows the in-button spinner when the mock
    // reports isLoading=true. We mock the hook so it returns isLoading=true
    // when called with a `before` cursor.
    const useMessagesMock = vi.mocked(useMessages);
    useMessagesMock.mockImplementation(((_id: string, opts?: { before?: string }) => ({
      data: { messages: sampleMessages, has_more: true },
      isLoading: !!opts?.before,
      isError: false,
    })) as unknown as typeof useMessages);
    render(<MessageThread channelId="chan-1" />);
    // Initial render — no before cursor, isLoading=false → button text visible.
    fireEvent.click(screen.getByText('Load older messages'));
    // After click, beforeCursor is set; the next render returns isLoading=true,
    // which renders the in-button "Loading..." copy.
    expect(screen.getByText(/Loading\.\.\./)).toBeDefined();
  });

  it('renders proposed-terms cards with no milestones section', () => {
    const termsContent = [
      '[Proposed Terms]',
      'Payment Type: lump_sum',
      'Amount: $750',
      'Description: One-shot project, no milestones.',
    ].join('\n');
    setMessages({
      messages: [makeMsg({ id: 'tm-no-milestones', content: termsContent })],
      has_more: false,
    });
    render(<MessageThread channelId="chan-1" />);
    expect(screen.getByText(/Proposed Terms/)).toBeDefined();
    // Milestones label/section is omitted when none are listed.
    expect(screen.queryByText('Milestones')).toBeNull();
  });

  it('renders proposed-terms cards with no description section', () => {
    const termsContent = [
      '[Proposed Terms]',
      'Payment Type: hourly',
      'Amount: $80/hr',
      'Milestones:',
      'Phase 1 - 4 hrs',
    ].join('\n');
    setMessages({
      messages: [makeMsg({ id: 'tm-no-desc', content: termsContent })],
      has_more: false,
    });
    render(<MessageThread channelId="chan-1" />);
    expect(screen.getByText(/Proposed Terms/)).toBeDefined();
    expect(screen.queryByText('Scope')).toBeNull();
  });

  // ---- ORDERING + SCROLL-ON-SEND (chat scroll bug) ----

  it('renders oldest→newest with the newest message at the bottom even when the API returns newest-first', () => {
    // The gateway returns messages ORDER BY created_at DESC (newest first).
    // The thread must normalize to ascending so the newest bubble is last.
    const older = makeMsg({ id: 'older', content: 'older message', created_at: '2026-04-01T11:00:00Z' });
    const newer = makeMsg({ id: 'newer', content: 'newer message', created_at: '2026-04-01T11:05:00Z' });
    setMessages({ messages: [newer, older], has_more: false });

    render(<MessageThread channelId="chan-1" />);

    const log = screen.getByRole('log');
    const html = log.innerHTML;
    // "older message" must appear before "newer message" in DOM order.
    expect(html.indexOf('older message')).toBeLessThan(html.indexOf('newer message'));
  });

  it('uses the genuinely-oldest message as the load-older cursor even when the API order is newest-first', () => {
    const useMessagesMock = vi.mocked(useMessages);
    const older = makeMsg({ id: 'older', created_at: '2026-04-01T11:00:00Z' });
    const newer = makeMsg({ id: 'newer', created_at: '2026-04-01T11:05:00Z' });
    // API order is newest-first: [newer, older].
    setMessages({ messages: [newer, older], has_more: true });

    render(<MessageThread channelId="chan-1" />);
    fireEvent.click(screen.getByText('Load older messages'));

    const lastCall = useMessagesMock.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    if (lastCall) {
      const opts = lastCall[1] as { before?: string } | undefined;
      // Must page before the OLDEST message, not the first array element.
      expect(opts?.before).toBe('older');
    }
  });

  it('scrolls the newest message into view when the user sends a new message', async () => {
    setMessages({ messages: sampleMessages, has_more: false });
    const { rerender } = render(<MessageThread channelId="chan-1" />);
    scrollIntoViewSpy.mockClear();

    // Simulate a new own message arriving (e.g. after send → query refetch).
    const withNew = [
      ...sampleMessages,
      makeMsg({
        id: 'msg-3',
        sender_id: 'user-me',
        content: 'my brand new message',
        created_at: '2026-04-01T11:10:00Z',
      }),
    ];
    setMessages({ messages: withNew, has_more: false });
    rerender(<MessageThread channelId="chan-1" />);

    await waitFor(() => {
      expect(scrollIntoViewSpy).toHaveBeenCalled();
    });
    // The newest own message is rendered (it is the scroll target at the bottom).
    expect(screen.getByText('my brand new message')).toBeDefined();
  });

  it('does not yank the reader down for an incoming message when scrolled away from the bottom', async () => {
    setMessages({ messages: sampleMessages, has_more: false });
    const { rerender, container } = render(<MessageThread channelId="chan-1" />);

    // The initial-load + first-message effects schedule a rAF scroll; flush it
    // so the assertion below only observes behavior from the incoming message.
    await new Promise((resolve) => { requestAnimationFrame(() => { resolve(null); }); });

    // Force the scroll container to report being scrolled far from the bottom.
    const scrollEl = container.querySelector('.overflow-y-auto');
    expect(scrollEl).not.toBeNull();
    if (scrollEl) {
      Object.defineProperty(scrollEl, 'scrollHeight', { value: 2000, configurable: true });
      Object.defineProperty(scrollEl, 'clientHeight', { value: 400, configurable: true });
      Object.defineProperty(scrollEl, 'scrollTop', { value: 0, configurable: true });
    }
    scrollIntoViewSpy.mockClear();

    // An INCOMING message (from the other party) arrives while scrolled up.
    const withIncoming = [
      ...sampleMessages,
      makeMsg({
        id: 'incoming-1',
        sender_id: 'user-other',
        content: 'incoming while reading history',
        created_at: '2026-04-01T11:20:00Z',
      }),
    ];
    setMessages({ messages: withIncoming, has_more: false });
    rerender(<MessageThread channelId="chan-1" />);

    // Give any rAF a chance to fire, then assert we did NOT auto-scroll.
    await new Promise((resolve) => { requestAnimationFrame(() => { resolve(null); }); });
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });
});
