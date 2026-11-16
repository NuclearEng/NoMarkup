// MessageInput — a proposal amount of zero. "0" used to fall through the
// number check into the free-text branch and was sent to the customer as
// "$0". Money on the platform must be positive, so a zero or negative number
// is refused with the form's existing "Enter a valid amount." message.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHANNEL_STATUS } from '@/types';

const h = vi.hoisted(() => ({
  propose: vi.fn<(vars: unknown) => Promise<unknown>>(),
  toastError: vi.fn<(message: string) => void>(),
  toastSuccess: vi.fn<(message: string) => void>(),
}));

vi.mock('@/hooks/useChannels', () => ({
  useSendMessage: () => ({ mutateAsync: vi.fn(() => Promise.resolve({})), isPending: false }),
  useSendProposedTerms: () => ({ mutateAsync: h.propose, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock('@/hooks/useWebSocket', () => ({
  useSendTypingIndicator: () => vi.fn(),
}));
vi.mock('@/hooks/useChatTemplates', () => ({
  useChatTemplates: () => ({ data: undefined, isLoading: false }),
  useUseChatTemplate: () => ({ mutate: vi.fn() }),
}));

const { MessageInput } = await import('@/components/chat/MessageInput');

function proposeWithAmount(amount: string) {
  render(<MessageInput channelId="chan-1" channelStatus={CHANNEL_STATUS.ACTIVE} canProposeTerms />);
  fireEvent.click(screen.getByLabelText('Propose terms'));
  fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: amount } });
  fireEvent.change(screen.getByLabelText(/Description/), { target: { value: 'Build a fence' } });
  fireEvent.click(screen.getByRole('button', { name: /Send Proposal/ }));
}

function sentAmount(): string | undefined {
  const call = h.propose.mock.calls[0]?.[0] as { input: { amount: string } } | undefined;
  return call?.input.amount;
}

beforeAll(() => {
  // Radix Select (payment type) needs these; jsdom has neither.
  if (!('ResizeObserver' in globalThis)) {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
      ResizeObserverStub;
  }
  Element.prototype.hasPointerCapture = (): boolean => false;
  Element.prototype.releasePointerCapture = (): void => undefined;
  Element.prototype.scrollIntoView = (): void => undefined;
});

beforeEach(() => {
  vi.clearAllMocks();
  h.propose.mockResolvedValue({});
});

describe('MessageInput — proposal amount', () => {
  // The field is <input type="number">, so only numeric text can reach it.
  it.each(['0', '0.00', '-5', '-12.50'])(
    'refuses %j with a validation message and sends nothing',
    (amount) => {
      proposeWithAmount(amount);

      expect(h.toastError).toHaveBeenCalledWith('Enter a valid amount.');
      expect(h.propose).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['250', '$250.00'],
    ['1250.5', '$1,250.50'],
    ['0.01', '$0.01'],
  ])('sends %j as %s', async (amount, formatted) => {
    proposeWithAmount(amount);

    await waitFor(() => {
      expect(h.propose).toHaveBeenCalledTimes(1);
    });
    expect(sentAmount()).toBe(formatted);
    expect(h.toastError).not.toHaveBeenCalled();
  });
});
