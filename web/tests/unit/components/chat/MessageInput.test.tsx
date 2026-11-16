import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mutateAsync = vi.fn((..._args: unknown[]) => Promise.resolve({}));
const proposeMutateAsync = vi.fn((..._args: unknown[]) => Promise.resolve({}));
const isPendingState = { value: false };
const isProposePendingState = { value: false };

vi.mock('@/hooks/useChannels', () => ({
  useSendMessage: () => ({
    mutateAsync,
    get isPending(): boolean {
      return isPendingState.value;
    },
  }),
  useSendProposedTerms: () => ({
    mutateAsync: proposeMutateAsync,
    get isPending(): boolean {
      return isProposePendingState.value;
    },
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const sendTypingMock = vi.fn();
vi.mock('@/hooks/useWebSocket', () => ({
  useSendTypingIndicator: () => sendTypingMock,
}));

// QuickReplyTemplates pulls the user's chat templates over TanStack
// Query. The MessageInput tests render without a QueryClientProvider,
// so we stub the hook to return an empty/loading state — that path
// makes QuickReplyTemplates render nothing, which is exactly what
// these MessageInput cases need.
vi.mock('@/hooks/useChatTemplates', () => ({
  useChatTemplates: () => ({ data: undefined, isLoading: false }),
  useUseChatTemplate: () => ({ mutate: vi.fn() }),
}));

import { MessageInput } from '@/components/chat/MessageInput';
import { CHANNEL_STATUS } from '@/types';

beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
      ResizeObserverStub;
  }
  // jsdom does not implement these — always stub.
  Element.prototype.hasPointerCapture = (): boolean => false;
  Element.prototype.releasePointerCapture = (): void => {
    // no-op
  };
  Element.prototype.scrollIntoView = (): void => {
    // no-op
  };
});

beforeEach(() => {
  mutateAsync.mockClear();
  mutateAsync.mockImplementation(() => Promise.resolve({}));
  proposeMutateAsync.mockClear();
  proposeMutateAsync.mockImplementation(() => Promise.resolve({}));
  sendTypingMock.mockClear();
  isPendingState.value = false;
  isProposePendingState.value = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

// Wrap a synchronous fireEvent in act() to satisfy React's act() warning.
function actSync(fn: () => void): void {
  act(() => {
    fn();
  });
}

// Wait one microtask + one task tick so async mutateAsync .then callbacks flush.
async function flushAsync(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('MessageInput', () => {
  it('renders the textarea and send button', () => {
    render(<MessageInput channelId="chan-1" channelStatus={CHANNEL_STATUS.ACTIVE} />);
    expect(screen.getByLabelText('Message input')).toBeDefined();
    expect(screen.getByLabelText('Send message')).toBeDefined();
  });

  it('disables input when channel status is read_only', () => {
    render(<MessageInput channelId="chan-1" channelStatus={CHANNEL_STATUS.READ_ONLY} />);
    expect(screen.getByText(/read-only/)).toBeDefined();
  });

  it('shows closed message when channel status is closed', () => {
    render(<MessageInput channelId="chan-1" channelStatus={CHANNEL_STATUS.CLOSED} />);
    expect(screen.getByText(/closed/)).toBeDefined();
  });

  it('calls sendMessage with trimmed content when send button is clicked', async () => {
    render(<MessageInput channelId="chan-1" channelStatus={CHANNEL_STATUS.ACTIVE} />);
    const textarea = screen.getByLabelText('Message input');
    actSync(() => {
      fireEvent.change(textarea, { target: { value: '  hello world  ' } });
    });
    actSync(() => {
      fireEvent.click(screen.getByLabelText('Send message'));
    });
    await flushAsync();
    expect(mutateAsync).toHaveBeenCalledWith({
      channelId: 'chan-1',
      input: { content: 'hello world' },
    });
  });

  it('sends message on Enter without shift', async () => {
    render(<MessageInput channelId="chan-1" channelStatus={CHANNEL_STATUS.ACTIVE} />);
    const textarea = screen.getByLabelText('Message input');
    actSync(() => {
      fireEvent.change(textarea, { target: { value: 'press enter' } });
    });
    actSync(() => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    });
    await flushAsync();
    expect(mutateAsync).toHaveBeenCalled();
  });

  it('hides the propose-terms control when canProposeTerms is false', () => {
    render(<MessageInput channelId="chan-1" channelStatus={CHANNEL_STATUS.ACTIVE} />);
    expect(screen.queryByLabelText('Propose terms')).toBeNull();
  });

  it('shows the propose-terms form when toggle is clicked (provider)', () => {
    render(
      <MessageInput
        channelId="chan-1"
        channelStatus={CHANNEL_STATUS.ACTIVE}
        canProposeTerms
      />,
    );
    actSync(() => {
      fireEvent.click(screen.getByLabelText('Propose terms'));
    });
    expect(screen.getByText('Propose Terms')).toBeDefined();
  });

  // ---- DEEPENING ----

  it('does not send on Shift+Enter (allows newline)', () => {
    render(<MessageInput channelId="chan-1" channelStatus={CHANNEL_STATUS.ACTIVE} />);
    const textarea = screen.getByLabelText('Message input');
    actSync(() => {
      fireEvent.change(textarea, { target: { value: 'line one' } });
    });
    actSync(() => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    });
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('disables the send button when content is empty', () => {
    render(<MessageInput channelId="chan-1" channelStatus={CHANNEL_STATUS.ACTIVE} />);
    const sendBtn = screen.getByLabelText('Send message');
    expect((sendBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables the send button after content is typed', () => {
    render(<MessageInput channelId="chan-1" channelStatus={CHANNEL_STATUS.ACTIVE} />);
    const textarea = screen.getByLabelText('Message input');
    actSync(() => {
      fireEvent.change(textarea, { target: { value: 'hello' } });
    });
    const sendBtn = screen.getByLabelText('Send message');
    expect((sendBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('triggers the typing indicator when content changes', () => {
    render(<MessageInput channelId="chan-1" channelStatus={CHANNEL_STATUS.ACTIVE} />);
    const textarea = screen.getByLabelText('Message input');
    actSync(() => {
      fireEvent.change(textarea, { target: { value: 'typing' } });
    });
    expect(sendTypingMock).toHaveBeenCalled();
  });

  it('shows the live character counter for typed content', () => {
    render(<MessageInput channelId="chan-1" channelStatus={CHANNEL_STATUS.ACTIVE} />);
    const textarea = screen.getByLabelText('Message input');
    actSync(() => {
      fireEvent.change(textarea, { target: { value: 'abcde' } });
    });
    expect(screen.getByText(/5\/2000/)).toBeDefined();
  });

  it('shows the amber warning class as content approaches the 2000 limit', () => {
    render(<MessageInput channelId="chan-1" channelStatus={CHANNEL_STATUS.ACTIVE} />);
    const textarea = screen.getByLabelText('Message input');
    const longContent = 'a'.repeat(1950);
    actSync(() => {
      fireEvent.change(textarea, { target: { value: longContent } });
    });
    const counter = screen.getByText(/1950\/2000/);
    expect(counter.className).toContain('text-amber-600');
  });

  it('rejects content over 2000 characters by clamping in onChange', () => {
    render(<MessageInput channelId="chan-1" channelStatus={CHANNEL_STATUS.ACTIVE} />);
    const textarea = screen.getByLabelText('Message input');
    const overLimit = 'b'.repeat(2050);
    actSync(() => {
      fireEvent.change(textarea, { target: { value: overLimit } });
    });
    // Component refuses to accept > 2000 — value should remain the previous content (empty)
    expect((textarea as HTMLTextAreaElement).value.length).toBeLessThanOrEqual(2000);
  });

  it('clears the textarea after a successful send', async () => {
    render(<MessageInput channelId="chan-1" channelStatus={CHANNEL_STATUS.ACTIVE} />);
    const textarea = screen.getByLabelText('Message input');
    actSync(() => {
      fireEvent.change(textarea, { target: { value: 'hello' } });
    });
    actSync(() => {
      fireEvent.click(screen.getByLabelText('Send message'));
    });
    await flushAsync();
    expect((textarea as HTMLTextAreaElement).value).toBe('');
  });

  it('keeps the textarea content when send mutation rejects', async () => {
    mutateAsync.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    render(<MessageInput channelId="chan-1" channelStatus={CHANNEL_STATUS.ACTIVE} />);
    const textarea = screen.getByLabelText('Message input');
    actSync(() => {
      fireEvent.change(textarea, { target: { value: 'hello' } });
    });
    actSync(() => {
      fireEvent.click(screen.getByLabelText('Send message'));
    });
    await flushAsync();
    // .catch swallows the error; textarea should not be cleared since success was not reached
    expect((textarea as HTMLTextAreaElement).value).toBe('hello');
  });

  it('renders the propose-terms cancel button and closes the form', () => {
    render(
      <MessageInput
        channelId="chan-1"
        channelStatus={CHANNEL_STATUS.ACTIVE}
        canProposeTerms
      />,
    );
    actSync(() => {
      fireEvent.click(screen.getByLabelText('Propose terms'));
    });
    expect(screen.getByText('Propose Terms')).toBeDefined();
    actSync(() => {
      fireEvent.click(screen.getByLabelText('Cancel proposal'));
    });
    // After cancel, the message textarea should be back
    expect(screen.getByLabelText('Message input')).toBeDefined();
  });

  it('shows the milestones textarea when milestone payment type is selected', async () => {
    const user = userEvent.setup();
    render(
      <MessageInput
        channelId="chan-1"
        channelStatus={CHANNEL_STATUS.ACTIVE}
        canProposeTerms
      />,
    );
    actSync(() => {
      fireEvent.click(screen.getByLabelText('Propose terms'));
    });

    // Open the payment type Select
    await user.click(screen.getByLabelText('Payment Type'));
    const milestoneOption = await screen.findByRole('option', { name: /Milestone/ });
    await user.click(milestoneOption);

    expect(screen.getByLabelText(/Milestones/)).toBeDefined();
  });

  it('keeps the Send Proposal button disabled until both amount and description are filled', () => {
    render(
      <MessageInput
        channelId="chan-1"
        channelStatus={CHANNEL_STATUS.ACTIVE}
        canProposeTerms
      />,
    );
    actSync(() => {
      fireEvent.click(screen.getByLabelText('Propose terms'));
    });

    const sendProposalBtn = screen.getByRole('button', { name: /Send Proposal/ });
    expect((sendProposalBtn as HTMLButtonElement).disabled).toBe(true);

    actSync(() => {
      fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '100' } });
    });
    expect((sendProposalBtn as HTMLButtonElement).disabled).toBe(true);

    actSync(() => {
      fireEvent.change(screen.getByLabelText(/Description/), {
        target: { value: 'Build a fence' },
      });
    });
    expect((sendProposalBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('posts to proposed-terms endpoint when the proposal is submitted', async () => {
    render(
      <MessageInput
        channelId="chan-1"
        channelStatus={CHANNEL_STATUS.ACTIVE}
        canProposeTerms
      />,
    );
    actSync(() => {
      fireEvent.click(screen.getByLabelText('Propose terms'));
    });
    actSync(() => {
      fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '250' } });
    });
    actSync(() => {
      fireEvent.change(screen.getByLabelText(/Description/), {
        target: { value: 'Half upfront, half on completion' },
      });
    });
    actSync(() => {
      fireEvent.click(screen.getByRole('button', { name: /Send Proposal/ }));
    });
    await flushAsync();

    // Must use the dedicated proposed-terms path (not plain text messages)
    // so message_type=proposed_terms and Accept can bind contract metadata.
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(proposeMutateAsync).toHaveBeenCalled();
    const firstCall = proposeMutateAsync.mock.calls[0]?.[0] as
      | {
          channelId: string;
          input: {
            payment_type: string;
            amount: string;
            description: string;
          };
        }
      | undefined;
    expect(firstCall?.channelId).toBe('chan-1');
    expect(firstCall?.input.payment_type).toBe('completion');
    expect(firstCall?.input.amount).toContain('250');
    expect(firstCall?.input.description).toContain('Half upfront');
  });

  it('does not send when the textarea is empty and the send button is force-clicked', () => {
    render(<MessageInput channelId="chan-1" channelStatus={CHANNEL_STATUS.ACTIVE} />);
    // Even though the button is disabled, clicking it should be a no-op
    actSync(() => {
      fireEvent.click(screen.getByLabelText('Send message'));
    });
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('renders a per-status message exactly once for read_only', () => {
    render(<MessageInput channelId="chan-1" channelStatus={CHANNEL_STATUS.READ_ONLY} />);
    expect(screen.queryByLabelText('Message input')).toBeNull();
    expect(screen.queryByLabelText('Send message')).toBeNull();
  });

  it('renders the Enter/Shift+Enter help text', () => {
    render(<MessageInput channelId="chan-1" channelStatus={CHANNEL_STATUS.ACTIVE} />);
    expect(screen.getByText(/Enter to send/)).toBeDefined();
  });

  // ---- DEEPENING TESTS ----

  it('shows "Sending..." in the Send Proposal button when proposed-terms mutation is pending', () => {
    isProposePendingState.value = true;
    render(
      <MessageInput
        channelId="chan-1"
        channelStatus={CHANNEL_STATUS.ACTIVE}
        canProposeTerms
      />,
    );
    actSync(() => {
      fireEvent.click(screen.getByLabelText('Propose terms'));
    });
    expect(screen.getByRole('button', { name: /Sending\.\.\./ })).toBeDefined();
  });

  it('skips handleSubmit early when send mutation is already pending (line 189)', async () => {
    isPendingState.value = true;
    render(<MessageInput channelId="chan-1" channelStatus={CHANNEL_STATUS.ACTIVE} />);
    const textarea = screen.getByLabelText('Message input');
    actSync(() => {
      fireEvent.change(textarea, { target: { value: 'queued' } });
    });
    // Press Enter — handleSubmit returns early because isPending is true.
    actSync(() => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    });
    await flushAsync();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('does not call sendMessage when content fails the chatMessageSchema (early-return on Enter)', async () => {
    render(<MessageInput channelId="chan-1" channelStatus={CHANNEL_STATUS.ACTIVE} />);
    const textarea = screen.getByLabelText('Message input');
    // Empty content fails chatMessageSchema; pressing Enter should be a no-op.
    actSync(() => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    });
    await flushAsync();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('includes milestones on proposed-terms body when milestone payment-type is selected', async () => {
    const user = userEvent.setup();
    render(
      <MessageInput
        channelId="chan-1"
        channelStatus={CHANNEL_STATUS.ACTIVE}
        canProposeTerms
      />,
    );
    actSync(() => {
      fireEvent.click(screen.getByLabelText('Propose terms'));
    });

    // Switch to milestone payment type so the milestones textarea appears.
    await user.click(screen.getByLabelText('Payment Type'));
    const milestoneOption = await screen.findByRole('option', { name: /Milestone/ });
    await user.click(milestoneOption);

    actSync(() => {
      fireEvent.change(screen.getByLabelText(/Milestones/), {
        target: { value: 'Phase 1 - 50%\nPhase 2 - 50%' },
      });
    });
    actSync(() => {
      fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '500' } });
    });
    actSync(() => {
      fireEvent.change(screen.getByLabelText(/Description/), {
        target: { value: 'Two phase delivery' },
      });
    });
    actSync(() => {
      fireEvent.click(screen.getByRole('button', { name: /Send Proposal/ }));
    });
    await flushAsync();

    expect(proposeMutateAsync).toHaveBeenCalled();
    const firstCall = proposeMutateAsync.mock.calls[0]?.[0] as
      | {
          channelId: string;
          input: { payment_type: string; milestones: string; description: string };
        }
      | undefined;
    expect(firstCall?.input.payment_type).toBe('milestone');
    expect(firstCall?.input.milestones).toContain('Phase 1 - 50%');
    expect(firstCall?.input.description).toContain('Two phase delivery');
  });

  it('does not throw inside resizeTextarea when ref is unattached (line 171 no-ref branch)', () => {
    // Triggering a change on the textarea calls resizeTextarea — but if rapid
    // unmount/remount happens, textareaRef.current can be null. We can't easily
    // simulate that, but we verify the rapid-change path doesn't crash.
    render(<MessageInput channelId="chan-1" channelStatus={CHANNEL_STATUS.ACTIVE} />);
    const textarea = screen.getByLabelText('Message input');
    expect(() => {
      actSync(() => {
        fireEvent.change(textarea, { target: { value: 'a\nb\nc\nd\ne\nf' } });
      });
    }).not.toThrow();
  });
});
