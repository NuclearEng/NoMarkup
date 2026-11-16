import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const flagState = { offers: true };
const requestedFlags: string[] = [];

vi.mock('@/hooks/useFeatureFlags', () => ({
  useFeatureFlag: (key: string) => {
    requestedFlags.push(key);
    return flagState.offers;
  },
}));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
  };
});

import { InlineOfferComposer, InlineOfferMessage } from '@/components/chat/InlineOfferMessage';
import { api, ApiError } from '@/lib/api';

interface Deferred {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

function deferred(): Deferred {
  let resolve: (value: unknown) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function openComposer(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Make an offer' }));
}

function typeAmount(value: string): void {
  fireEvent.change(screen.getByLabelText('Offer amount in dollars'), { target: { value } });
}

beforeEach(() => {
  vi.clearAllMocks();
  requestedFlags.length = 0;
  flagState.offers = true;
  vi.mocked(api.post).mockResolvedValue({});
  vi.mocked(api.patch).mockResolvedValue({});
});

describe('InlineOfferComposer', () => {
  it('renders nothing when the marketplace_offers flag is off', () => {
    flagState.offers = false;
    const { container } = render(<InlineOfferComposer listingId="l-1" />);
    expect(container).toBeEmptyDOMElement();
    expect(requestedFlags).toContain('marketplace_offers');
  });

  it('renders nothing when the caller disables offers for this thread', () => {
    const { container } = render(<InlineOfferComposer listingId="l-1" enabled={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('starts collapsed and keeps Send disabled until an amount is entered', () => {
    render(<InlineOfferComposer listingId="l-1" className="mt-4" />);
    expect(screen.getByRole('button', { name: 'Make an offer' })).toHaveClass('mt-4');
    expect(screen.queryByLabelText('Offer amount in dollars')).not.toBeInTheDocument();
    openComposer();
    expect(screen.getByRole('button', { name: 'Send offer' })).toBeDisabled();
    typeAmount('45');
    expect(screen.getByRole('button', { name: 'Send offer' })).toBeEnabled();
  });

  it('rejects a zero or negative amount without calling the API', () => {
    render(<InlineOfferComposer listingId="l-1" />);
    openComposer();
    typeAmount('0');
    fireEvent.click(screen.getByRole('button', { name: 'Send offer' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a positive amount.');
    typeAmount('-5');
    fireEvent.click(screen.getByRole('button', { name: 'Send offer' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a positive amount.');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('posts the offer in cents, disables Send while in flight, then collapses', async () => {
    const pending = deferred();
    vi.mocked(api.post).mockReturnValueOnce(pending.promise);
    render(<InlineOfferComposer listingId="l-1" />);
    openComposer();
    typeAmount('45.5');
    fireEvent.click(screen.getByRole('button', { name: 'Send offer' }));
    expect(api.post).toHaveBeenCalledWith('/api/v1/listings/l-1/offers', { amount_cents: 4550 });
    expect(screen.getByRole('button', { name: 'Send offer' })).toBeDisabled();

    await act(async () => {
      pending.resolve({});
      await pending.promise;
    });
    expect(screen.getByRole('button', { name: 'Make an offer' })).toBeInTheDocument();
    openComposer();
    expect(screen.getByLabelText('Offer amount in dollars')).toHaveValue(null);
  });

  it('shows the gateway reason when the offer is rejected by the API', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(
      new ApiError(409, JSON.stringify({ error: 'listing is no longer active' })),
    );
    render(<InlineOfferComposer listingId="l-1" />);
    openComposer();
    typeAmount('45');
    fireEvent.click(screen.getByRole('button', { name: 'Send offer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('listing is no longer active');
    expect(screen.getByRole('button', { name: 'Send offer' })).toBeEnabled();
    expect(screen.getByLabelText('Offer amount in dollars')).toHaveValue(45);
  });

  it('shows generic copy for a network failure', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new TypeError('fetch failed'));
    render(<InlineOfferComposer listingId="l-1" />);
    openComposer();
    typeAmount('45');
    fireEvent.click(screen.getByRole('button', { name: 'Send offer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to send offer.');
  });

  it('cancel collapses and discards both the amount and the error', () => {
    render(<InlineOfferComposer listingId="l-1" />);
    openComposer();
    typeAmount('0');
    fireEvent.click(screen.getByRole('button', { name: 'Send offer' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel offer' }));
    expect(screen.queryByLabelText('Offer amount in dollars')).not.toBeInTheDocument();
    openComposer();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Offer amount in dollars')).toHaveValue(null);
  });
});

describe('InlineOfferMessage', () => {
  it('shows Accept and Reject to the recipient of a pending offer, with no status line', () => {
    render(<InlineOfferMessage offerId="o-1" amountLabel="$45.00" isRecipient status="pending" className="w-64" />);
    expect(screen.getByTestId('inline-offer-message')).toHaveClass('w-64');
    expect(screen.getByText('$45.00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled();
    expect(screen.queryByText('pending')).not.toBeInTheDocument();
  });

  it('hides the actions from the sender of a pending offer', () => {
    render(<InlineOfferMessage offerId="o-1" amountLabel="$45.00" isRecipient={false} status="pending" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each(['accepted', 'rejected', 'countered', 'expired'] as const)(
    'shows the "%s" status instead of actions once the offer is resolved',
    (status) => {
      render(<InlineOfferMessage offerId="o-1" amountLabel="$45.00" isRecipient status={status} />);
      expect(screen.getByText(status)).toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    },
  );

  it('accepts via PATCH and locks both buttons while the request is in flight', async () => {
    const pending = deferred();
    vi.mocked(api.patch).mockReturnValueOnce(pending.promise);
    render(<InlineOfferMessage offerId="o-1" amountLabel="$45.00" isRecipient status="pending" />);
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(api.patch).toHaveBeenCalledWith('/api/v1/offers/o-1', { action: 'accept' });
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();

    await act(async () => {
      pending.resolve({});
      await pending.promise;
    });
    expect(screen.getByRole('button', { name: 'Accept' })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('rejects via PATCH with the reject action', async () => {
    render(<InlineOfferMessage offerId="o-9" amountLabel="$10.00" isRecipient status="pending" />);
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(api.patch).toHaveBeenCalledWith('/api/v1/offers/o-9', { action: 'reject' });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled();
    });
  });

  it('surfaces the gateway reason when the response fails, and clears it on retry', async () => {
    vi.mocked(api.patch).mockRejectedValueOnce(
      new ApiError(409, JSON.stringify({ error: 'offer already expired' })),
    );
    render(<InlineOfferMessage offerId="o-1" amountLabel="$45.00" isRecipient status="pending" />);
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('offer already expired');

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
    expect(api.patch).toHaveBeenCalledTimes(2);
  });

  it('shows generic copy when the failure is not an API error', async () => {
    vi.mocked(api.patch).mockRejectedValueOnce(new Error('offline'));
    render(<InlineOfferMessage offerId="o-1" amountLabel="$45.00" isRecipient status="pending" />);
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to update offer.');
  });
});
