// "Make an offer" modal (buyer side of Best-Offer).
// MOCKED: useCreateOffer (the mutation). PROVEN: dollars → integer cents,
// message trimming, the guards against empty / zero / negative amounts, the
// pending state, and reset + close on success.
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateOfferInput } from '@/hooks/useOffers';

const mocks = vi.hoisted(() => ({
  mutate:
    vi.fn<(input: CreateOfferInput, callbacks?: { onSuccess?: () => void }) => void>(),
  state: { isPending: false, listingIds: [] as string[] },
}));

vi.mock('@/hooks/useOffers', () => ({
  useCreateOffer: (listingId: string) => {
    mocks.state.listingIds.push(listingId);
    return { mutate: mocks.mutate, isPending: mocks.state.isPending };
  },
}));

import { OfferModal } from '@/components/marketplace/OfferModal';

const onOpenChange = vi.fn<(open: boolean) => void>();

function renderModal(props: { open?: boolean; currentPriceCents?: number } = {}) {
  return render(
    <OfferModal
      listingId="l-1"
      currentPriceCents={props.currentPriceCents ?? 12050}
      open={props.open ?? true}
      onOpenChange={onOpenChange}
    />,
  );
}

function amountInput(): HTMLElement {
  return screen.getByLabelText('Your offer (USD)');
}

function messageInput(): HTMLElement {
  return screen.getByLabelText('Message (optional)');
}

function submitForm() {
  const form = amountInput().closest('form');
  if (!form) throw new Error('expected the amount input to live in a form');
  fireEvent.submit(form);
}

function typeAmount(value: string) {
  fireEvent.change(amountInput(), { target: { value } });
}

beforeEach(() => {
  mocks.mutate.mockReset();
  mocks.state.isPending = false;
  mocks.state.listingIds = [];
  onOpenChange.mockReset();
});

describe('OfferModal', () => {
  it('renders nothing while closed', () => {
    renderModal({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('quotes the asking price and the 24-hour response window', () => {
    renderModal({ currentPriceCents: 12050 });
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Submit a price below the $120.50 asking price. The seller has 24 hours to accept, reject, or counter your offer.',
    );
  });

  it('creates the offer against the listing it was opened for', () => {
    renderModal();
    expect(mocks.state.listingIds).toContain('l-1');
  });

  it('keeps Send disabled until an amount is entered', () => {
    renderModal();
    const send = screen.getByRole('button', { name: 'Send offer' });
    expect(send).toBeDisabled();
    typeAmount('95');
    expect(send).toBeEnabled();
    typeAmount('');
    expect(send).toBeDisabled();
  });

  it('sends the amount as integer cents with no message when none was written', () => {
    renderModal();
    typeAmount('95');
    submitForm();
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate.mock.calls[0]?.[0]).toEqual({
      amount_cents: 9500,
      message: undefined,
    });
  });

  it.each([
    ['95.1', 9510], // 95.1 * 100 is 9509.999… in floating point
    ['19.99', 1999],
    ['0.07', 7],
    ['1234.5', 123450],
  ])('rounds $%s to %i cents', (typed, cents) => {
    renderModal();
    typeAmount(typed);
    submitForm();
    expect(mocks.mutate.mock.calls[0]?.[0].amount_cents).toBe(cents);
  });

  it('trims the message before sending', () => {
    renderModal();
    typeAmount('80');
    fireEvent.change(messageInput(), { target: { value: '  Can pick up today  ' } });
    submitForm();
    expect(mocks.mutate.mock.calls[0]?.[0]).toEqual({
      amount_cents: 8000,
      message: 'Can pick up today',
    });
  });

  it('omits a message that is only whitespace', () => {
    renderModal();
    typeAmount('80');
    fireEvent.change(messageInput(), { target: { value: '   \n ' } });
    submitForm();
    expect(mocks.mutate.mock.calls[0]?.[0].message).toBeUndefined();
  });

  it('counts message characters against the 500 limit', () => {
    renderModal();
    expect(screen.getByText('0 / 500')).toBeInTheDocument();
    fireEvent.change(messageInput(), { target: { value: 'Hello' } });
    expect(screen.getByText('5 / 500')).toBeInTheDocument();
    expect(messageInput()).toHaveAttribute('maxlength', '500');
  });

  it.each(['0', '-5', ''])('does not send an offer of "%s"', (typed) => {
    renderModal();
    typeAmount(typed);
    submitForm();
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('locks the form and shows "Sending…" while the offer is in flight', () => {
    mocks.state.isPending = true;
    renderModal();
    expect(amountInput()).toBeDisabled();
    expect(messageInput()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Send offer' })).toBeNull();
  });

  it('clears the form and asks the parent to close once the offer is accepted by the API', () => {
    mocks.mutate.mockImplementation((_input, callbacks) => {
      callbacks?.onSuccess?.();
    });
    renderModal();
    typeAmount('80');
    fireEvent.change(messageInput(), { target: { value: 'Note' } });
    submitForm();

    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(amountInput()).toHaveValue(null);
    expect(messageInput()).toHaveValue('');
    expect(screen.getByText('0 / 500')).toBeInTheDocument();
  });

  it('keeps what the buyer typed, and stays open, when the offer has not succeeded', () => {
    renderModal();
    typeAmount('80');
    fireEvent.change(messageInput(), { target: { value: 'Note' } });
    submitForm();

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(amountInput()).toHaveValue(80);
    expect(messageInput()).toHaveValue('Note');
  });

  it('Cancel asks the parent to close without sending', () => {
    renderModal();
    typeAmount('80');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});
