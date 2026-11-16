import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface MutateCallbacks<TData> {
  onSuccess: (data: TData) => void;
  onError: (err: unknown) => void;
}
interface CreateVars {
  listingId: string;
  input: { intended_bid_cents: number };
}
interface CreateData {
  bond_id: string;
  setup_intent_client_secret: string;
}
interface ConfirmVars {
  listingId: string;
  bondId: string;
}
interface StripeLike {
  confirmSetup: (args: { elements: unknown; redirect: string }) => Promise<{ error?: { message?: string } }>;
}

const createMutate = vi.fn<(vars: CreateVars, callbacks: MutateCallbacks<CreateData>) => void>();
const confirmMutate = vi.fn<(vars: ConfirmVars, callbacks: MutateCallbacks<unknown>) => void>();
// Stable objects: the mint effect lists the mutation in its deps.
const createMutation = { mutate: createMutate, isPending: false };
const confirmMutation = { mutate: confirmMutate };

const confirmSetup = vi.fn<StripeLike['confirmSetup']>();
const stripeState: { stripe: StripeLike | null; elements: { id: string } | null; configured: boolean } = {
  stripe: null,
  elements: null,
  configured: true,
};
const elementsOptions: unknown[] = [];

vi.mock('@/hooks/useCompliance', () => ({
  useCreateBidBond: () => createMutation,
  useConfirmBidBond: () => confirmMutation,
}));

vi.mock('@/lib/stripe', () => ({
  getStripe: () => null,
  isStripeConfigured: () => stripeState.configured,
}));

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children, options }: { children?: ReactNode; options?: unknown }) => {
    elementsOptions.push(options);
    return <div data-testid="stripe-elements">{children}</div>;
  },
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => stripeState.stripe,
  useElements: () => stripeState.elements,
}));

import { BidBondPrompt } from '@/components/compliance/BidBondPrompt';
import { ApiError } from '@/lib/api';

const onAuthorized = vi.fn();

function renderPrompt() {
  return render(<BidBondPrompt listingId="l-1" intendedBidCents={250000} onAuthorized={onAuthorized} />);
}

function createCallbacks(): MutateCallbacks<CreateData> {
  const call = createMutate.mock.calls[0];
  if (!call) throw new Error('create bond was not requested');
  return call[1];
}

function confirmCallbacks(): MutateCallbacks<unknown> {
  const call = confirmMutate.mock.calls[0];
  if (!call) throw new Error('confirm bond was not requested');
  return call[1];
}

function mintBond(clientSecret: string): void {
  act(() => {
    createCallbacks().onSuccess({ bond_id: 'bond-1', setup_intent_client_secret: clientSecret });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  elementsOptions.length = 0;
  createMutation.isPending = false;
  stripeState.stripe = { confirmSetup };
  stripeState.elements = { id: 'elements' };
  stripeState.configured = true;
  confirmSetup.mockResolvedValue({});
});

describe('BidBondPrompt minting', () => {
  it('requests a bond for the intended bid once and shows a preparing state', () => {
    const { rerender } = renderPrompt();
    expect(screen.getByTestId('bid-bond-loading')).toHaveTextContent('Preparing bond…');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(createMutate).toHaveBeenCalledTimes(1);
    expect(createMutate.mock.calls[0]?.[0]).toEqual({
      listingId: 'l-1',
      input: { intended_bid_cents: 250000 },
    });
    rerender(<BidBondPrompt listingId="l-1" intendedBidCents={250000} onAuthorized={onAuthorized} />);
    expect(createMutate).toHaveBeenCalledTimes(1);
  });

  it('does not fire a second mint while one is already pending', () => {
    createMutation.isPending = true;
    renderPrompt();
    expect(createMutate).not.toHaveBeenCalled();
    expect(screen.getByTestId('bid-bond-loading')).toBeInTheDocument();
  });

  it('shows the gateway reason when the bond cannot be started', () => {
    renderPrompt();
    act(() => {
      createCallbacks().onError(new ApiError(403, JSON.stringify({ error: 'age not verified' })));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('age not verified');
    expect(screen.getByTestId('bid-bond-loading')).toBeInTheDocument();
  });

  it('falls back to generic copy for an unknown mint failure', () => {
    renderPrompt();
    act(() => {
      createCallbacks().onError(null);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to start bond');
  });
});

describe('BidBondPrompt dev fallback', () => {
  it.each(['dev_bond_seti_abc', 'dev_seti_abc'])(
    'skips Stripe for the %s sentinel and confirms directly',
    (secret) => {
      stripeState.configured = false;
      renderPrompt();
      mintBond(secret);
      expect(screen.getByTestId('bid-bond-dev-host')).toBeInTheDocument();
      expect(screen.queryByTestId('stripe-elements')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Authorize (dev)' }));
      expect(confirmMutate.mock.calls[0]?.[0]).toEqual({ listingId: 'l-1', bondId: 'bond-1' });
      expect(screen.getByRole('button', { name: 'Authorizing…' })).toBeDisabled();

      act(() => {
        confirmCallbacks().onSuccess({});
      });
      expect(onAuthorized).toHaveBeenCalledTimes(1);
    },
  );

  it('shows the confirmation error and re-enables the dev button', () => {
    renderPrompt();
    mintBond('dev_bond_seti_abc');
    fireEvent.click(screen.getByRole('button', { name: 'Authorize (dev)' }));
    act(() => {
      confirmCallbacks().onError(new Error('bond expired'));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('bond expired');
    expect(screen.getByRole('button', { name: 'Authorize (dev)' })).toBeEnabled();
    expect(onAuthorized).not.toHaveBeenCalled();

    // Retrying clears the stale error.
    fireEvent.click(screen.getByRole('button', { name: 'Authorize (dev)' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('uses generic copy when the dev confirmation fails without a message', () => {
    renderPrompt();
    mintBond('dev_seti_abc');
    fireEvent.click(screen.getByRole('button', { name: 'Authorize (dev)' }));
    act(() => {
      confirmCallbacks().onError(undefined);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Bond confirmation failed');
  });
});

describe('BidBondPrompt Stripe flow', () => {
  it('explains that payments are not set up when a real SetupIntent arrives without a publishable key', () => {
    stripeState.configured = false;
    renderPrompt();
    mintBond('seti_live_secret');
    expect(screen.getByRole('alert')).toHaveTextContent(/Bid bonds need payment processing/);
    expect(screen.queryByTestId('stripe-elements')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bid-bond-dev-host')).not.toBeInTheDocument();
  });

  it('mounts Stripe Elements with the SetupIntent client secret', () => {
    renderPrompt();
    mintBond('seti_live_secret');
    expect(screen.getByTestId('payment-element')).toBeInTheDocument();
    expect(elementsOptions[0]).toMatchObject({ clientSecret: 'seti_live_secret' });
    expect(screen.getByRole('button', { name: 'Authorize bond' })).toBeEnabled();
  });

  it('keeps Authorize disabled until Stripe and Elements have loaded', () => {
    stripeState.stripe = null;
    const { rerender } = renderPrompt();
    mintBond('seti_live_secret');
    expect(screen.getByRole('button', { name: 'Authorize bond' })).toBeDisabled();

    stripeState.stripe = { confirmSetup };
    stripeState.elements = null;
    rerender(<BidBondPrompt listingId="l-1" intendedBidCents={250000} onAuthorized={onAuthorized} />);
    expect(screen.getByRole('button', { name: 'Authorize bond' })).toBeDisabled();
    expect(confirmSetup).not.toHaveBeenCalled();
  });

  it('authorizes the card with Stripe, then confirms the bond and notifies the parent', async () => {
    renderPrompt();
    mintBond('seti_live_secret');
    fireEvent.click(screen.getByRole('button', { name: 'Authorize bond' }));
    expect(screen.getByRole('button', { name: 'Authorizing bond…' })).toBeDisabled();

    await waitFor(() => {
      expect(confirmMutate).toHaveBeenCalledTimes(1);
    });
    expect(confirmSetup).toHaveBeenCalledWith({ elements: { id: 'elements' }, redirect: 'if_required' });
    expect(confirmMutate.mock.calls[0]?.[0]).toEqual({ listingId: 'l-1', bondId: 'bond-1' });

    act(() => {
      confirmCallbacks().onSuccess({});
    });
    expect(onAuthorized).toHaveBeenCalledTimes(1);
  });

  it('shows the card decline reason and never confirms the bond', async () => {
    confirmSetup.mockResolvedValueOnce({ error: { message: 'Your card was declined.' } });
    renderPrompt();
    mintBond('seti_live_secret');
    fireEvent.click(screen.getByRole('button', { name: 'Authorize bond' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your card was declined.');
    expect(confirmMutate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Authorize bond' })).toBeEnabled();
  });

  it('uses fallback copy when Stripe returns an error without a message', async () => {
    confirmSetup.mockResolvedValueOnce({ error: {} });
    renderPrompt();
    mintBond('seti_live_secret');
    fireEvent.click(screen.getByRole('button', { name: 'Authorize bond' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Card could not be authorized');
  });

  it('shows the server reason when the bond confirmation fails after the card is authorized', async () => {
    renderPrompt();
    mintBond('seti_live_secret');
    fireEvent.click(screen.getByRole('button', { name: 'Authorize bond' }));
    await waitFor(() => {
      expect(confirmMutate).toHaveBeenCalledTimes(1);
    });
    act(() => {
      confirmCallbacks().onError(new ApiError(409, JSON.stringify({ error: 'bond already released' })));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('bond already released');
    expect(screen.getByRole('button', { name: 'Authorize bond' })).toBeEnabled();
    expect(onAuthorized).not.toHaveBeenCalled();
  });
});
