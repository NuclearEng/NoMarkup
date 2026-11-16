// Behavior tests for the admin platform-banking page: the current-account card
// and its remove confirmation, and the Stripe-tokenized "set payout account"
// form (validation, tokenization failures, the payload sent to our API).
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlatformBankAccount } from '@/types';

import { getDialog, installDialogStub } from './_admin-branch-helpers';
import { withQueryClient } from './_helpers';

vi.mock('@/components/ui/select', () => import('./_native-select-mock'));

const usePlatformBankingMock = vi.fn();
const setAccountMutateAsync = vi.fn();
const setAccountState = { isPending: false };
const deleteMutate = vi.fn();
const deleteState = { isPending: false };

vi.mock('@/hooks/useAdmin', () => ({
  usePlatformBanking: () => usePlatformBankingMock() as unknown,
  useSetPlatformBankAccount: () => ({
    mutateAsync: setAccountMutateAsync,
    isPending: setAccountState.isPending,
  }),
  useDeletePlatformBankAccount: () => ({
    mutate: deleteMutate,
    isPending: deleteState.isPending,
  }),
}));

const getStripeMock = vi.fn();
const createTokenMock = vi.fn();
const stripeState = { configured: true };

vi.mock('@/lib/stripe', () => ({
  getStripe: () => getStripeMock() as unknown,
  isStripeConfigured: () => stripeState.configured,
}));

import AdminBankingPage from '@/app/(dashboard)/admin/banking/page';

function makeAccount(overrides: Partial<PlatformBankAccount> = {}): PlatformBankAccount {
  return {
    id: 'ba-1',
    bank_name: 'First Test Bank',
    account_holder_name: 'NoMarkup Inc.',
    account_holder_type: 'company',
    last4: '6789',
    routing_last4: '0000',
    currency: 'usd',
    country: 'us',
    status: 'verification_failed',
    is_default: true,
    created_at: '2026-03-05T12:00:00Z',
    updated_at: '2026-03-05T12:00:00Z',
    ...overrides,
  };
}

function loaded(account: PlatformBankAccount | null) {
  usePlatformBankingMock.mockReturnValue({ data: { account }, isLoading: false, isError: false });
}

function page() {
  return withQueryClient(createElement(AdminBankingPage));
}

async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  values: { name?: string; routing?: string; account?: string },
) {
  if (values.name) await user.type(screen.getByLabelText('Account holder name'), values.name);
  if (values.routing) await user.type(screen.getByLabelText('Routing number'), values.routing);
  if (values.account) await user.type(screen.getByLabelText('Account number'), values.account);
}

const VALID = { name: 'NoMarkup Inc.', routing: '110000000', account: '000123456789' };

beforeAll(() => {
  installDialogStub();
});

beforeEach(() => {
  vi.clearAllMocks();
  usePlatformBankingMock.mockReset();
  setAccountMutateAsync.mockReset().mockResolvedValue({ account: makeAccount() });
  createTokenMock.mockReset().mockResolvedValue({ token: { id: 'btok_123' } });
  getStripeMock.mockReset().mockResolvedValue({ createToken: createTokenMock });
  setAccountState.isPending = false;
  deleteState.isPending = false;
  stripeState.configured = true;
});

describe('AdminBankingPage — current account', () => {
  it('shows neither an account nor the empty state while loading', () => {
    usePlatformBankingMock.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    render(page());

    expect(screen.queryByText('Current Payout Account')).not.toBeInTheDocument();
    expect(screen.queryByText('No payout account set')).not.toBeInTheDocument();
    expect(screen.queryByText('Failed to load banking details')).not.toBeInTheDocument();
    // The form is always available.
    expect(screen.getByRole('button', { name: 'Save bank account' })).toBeInTheDocument();
  });

  it('shows the error state when banking details fail to load', () => {
    usePlatformBankingMock.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(page());

    expect(screen.getByText('Failed to load banking details')).toBeInTheDocument();
    expect(screen.queryByText('No payout account set')).not.toBeInTheDocument();
  });

  it('shows the empty state when no payout account is set', () => {
    loaded(null);
    render(page());

    expect(screen.getByText('No payout account set')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove account' })).not.toBeInTheDocument();
  });

  it('renders the masked account with humanised status, currency and country', () => {
    loaded(makeAccount());
    render(page());

    expect(screen.getByText('First Test Bank')).toBeInTheDocument();
    expect(screen.getByText('NoMarkup Inc. (company)')).toBeInTheDocument();
    expect(screen.getByText('••••6789')).toBeInTheDocument();
    expect(screen.getByText('••••0000')).toBeInTheDocument();
    expect(screen.getByText('USD · US')).toBeInTheDocument();
    expect(screen.getByText('verification failed')).toBeInTheDocument();
    expect(screen.getByText('Mar 5, 2026')).toBeInTheDocument();
  });

  it('shows a dash when Stripe returned no bank name', () => {
    loaded(makeAccount({ bank_name: '' }));
    render(page());

    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('removes the account only after confirmation and closes once settled', async () => {
    const user = userEvent.setup();
    loaded(makeAccount({ id: 'ba-77' }));
    const { container } = render(page());
    const dialog = getDialog(container);

    await user.click(screen.getByRole('button', { name: 'Remove account' }));
    expect(dialog).toHaveAttribute('open');
    expect(
      within(dialog).getByRole('heading', { name: 'Remove platform bank account?' }),
    ).toBeInTheDocument();
    expect(deleteMutate).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Remove account' }));

    expect(deleteMutate).toHaveBeenCalledTimes(1);
    const [id, options] = deleteMutate.mock.calls[0] as [string, { onSettled: () => void }];
    expect(id).toBe('ba-77');
    // Still open until the mutation settles (success or failure).
    expect(dialog).toHaveAttribute('open');

    act(() => {
      options.onSettled();
    });
    expect(dialog).not.toHaveAttribute('open');
  });

  it('cancelling the confirmation keeps the account', async () => {
    const user = userEvent.setup();
    loaded(makeAccount());
    const { container } = render(page());
    const dialog = getDialog(container);

    await user.click(screen.getByRole('button', { name: 'Remove account' }));
    await user.click(within(dialog).getByRole('button', { name: 'Cancel action' }));

    expect(dialog).not.toHaveAttribute('open');
    expect(deleteMutate).not.toHaveBeenCalled();
  });

  it('refuses to dismiss the confirmation while the removal is in flight', async () => {
    const user = userEvent.setup();
    loaded(makeAccount());
    const { container, rerender } = render(page());
    const dialog = getDialog(container);

    await user.click(screen.getByRole('button', { name: 'Remove account' }));
    expect(dialog).toHaveAttribute('open');

    deleteState.isPending = true;
    rerender(page());

    expect(screen.getByRole('button', { name: 'Removing...' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel action' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Remove account' })).toHaveTextContent(
      'Processing...',
    );

    // Escape on a native <dialog> fires `close`; it must be ignored mid-flight.
    fireEvent(dialog, new Event('close'));
    expect(dialog).toHaveAttribute('open');

    deleteState.isPending = false;
    rerender(page());
    fireEvent(dialog, new Event('close'));
    expect(dialog).not.toHaveAttribute('open');
  });
});

describe('AdminBankingPage — set payout account form', () => {
  it('flags every missing field and never reaches Stripe', async () => {
    const user = userEvent.setup();
    loaded(null);
    render(page());

    await user.click(screen.getByRole('button', { name: 'Save bank account' }));

    expect(screen.getByText('Account holder name is required')).toBeInTheDocument();
    expect(screen.getByText('Routing number must be 9 digits')).toBeInTheDocument();
    expect(screen.getByText('Account number must be 4-17 digits')).toBeInTheDocument();

    const name = screen.getByLabelText('Account holder name');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Account holder name is required');
    expect(screen.getByLabelText('Routing number')).toHaveAccessibleDescription(
      'Routing number must be 9 digits',
    );
    expect(screen.getByLabelText('Account number')).toHaveAccessibleDescription(
      'Account number must be 4-17 digits',
    );

    expect(getStripeMock).not.toHaveBeenCalled();
    expect(setAccountMutateAsync).not.toHaveBeenCalled();
  });

  it('flags only the malformed field and clears errors once the form is valid', async () => {
    const user = userEvent.setup();
    loaded(null);
    render(page());

    await fillForm(user, { name: VALID.name, routing: '12345', account: VALID.account });
    await user.click(screen.getByRole('button', { name: 'Save bank account' }));

    expect(screen.getByText('Routing number must be 9 digits')).toBeInTheDocument();
    expect(screen.queryByText('Account holder name is required')).not.toBeInTheDocument();
    expect(screen.queryByText('Account number must be 4-17 digits')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Account holder name')).not.toHaveAttribute('aria-invalid');
    expect(getStripeMock).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Routing number'), '6789');
    await user.click(screen.getByRole('button', { name: 'Save bank account' }));

    await waitFor(() => {
      expect(setAccountMutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText('Routing number must be 9 digits')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Routing number')).not.toHaveAttribute('aria-invalid');
  });

  it('tokenizes with Stripe and sends only the token to our API, then clears the form', async () => {
    const user = userEvent.setup();
    loaded(null);
    render(page());

    await fillForm(user, { ...VALID, name: '  NoMarkup Inc.  ' });
    await user.click(screen.getByRole('button', { name: 'Save bank account' }));

    await waitFor(() => {
      expect(setAccountMutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(createTokenMock).toHaveBeenCalledExactlyOnceWith('bank_account', {
      country: 'US',
      currency: 'usd',
      account_holder_name: 'NoMarkup Inc.',
      account_holder_type: 'company',
      routing_number: '110000000',
      account_number: '000123456789',
    });
    // Raw routing/account numbers must never be sent to our backend.
    expect(setAccountMutateAsync).toHaveBeenCalledWith({
      bank_account_token: 'btok_123',
      account_holder_name: 'NoMarkup Inc.',
      account_holder_type: 'company',
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Account number')).toHaveValue('');
    });
    expect(screen.getByLabelText('Routing number')).toHaveValue('');
    expect(screen.getByLabelText('Account holder name')).toHaveValue('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save bank account' })).toBeEnabled();
  });

  it('sends the selected holder type to both Stripe and our API', async () => {
    const user = userEvent.setup();
    loaded(null);
    render(page());

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'individual' } });
    await fillForm(user, VALID);
    await user.click(screen.getByRole('button', { name: 'Save bank account' }));

    await waitFor(() => {
      expect(setAccountMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ account_holder_type: 'individual' }),
      );
    });
    expect(createTokenMock).toHaveBeenCalledWith(
      'bank_account',
      expect.objectContaining({ account_holder_type: 'individual' }),
    );
  });

  it('reports when Stripe.js cannot be loaded and keeps the entered values', async () => {
    const user = userEvent.setup();
    getStripeMock.mockResolvedValue(null);
    loaded(null);
    render(page());

    await fillForm(user, VALID);
    await user.click(screen.getByRole('button', { name: 'Save bank account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to load Stripe. Please try again.',
    );
    expect(createTokenMock).not.toHaveBeenCalled();
    expect(setAccountMutateAsync).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Routing number')).toHaveValue('110000000');
    expect(screen.getByRole('button', { name: 'Save bank account' })).toBeEnabled();
  });

  it("shows Stripe's own message when tokenization is rejected", async () => {
    const user = userEvent.setup();
    createTokenMock.mockResolvedValue({ error: { message: 'Your routing number is invalid.' } });
    loaded(null);
    render(page());

    await fillForm(user, VALID);
    await user.click(screen.getByRole('button', { name: 'Save bank account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Your routing number is invalid.');
    expect(setAccountMutateAsync).not.toHaveBeenCalled();
  });

  it('falls back to a generic message when Stripe gives no reason, and clears it on retry', async () => {
    const user = userEvent.setup();
    createTokenMock.mockResolvedValueOnce({ error: {} });
    loaded(null);
    render(page());

    await fillForm(user, VALID);
    await user.click(screen.getByRole('button', { name: 'Save bank account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to verify bank account.');

    await user.click(screen.getByRole('button', { name: 'Save bank account' }));

    await waitFor(() => {
      expect(setAccountMutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows "Saving..." and blocks resubmission while tokenization is in flight', async () => {
    const user = userEvent.setup();
    let release: (value: unknown) => void = () => undefined;
    getStripeMock.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    loaded(null);
    render(page());

    await fillForm(user, VALID);
    await user.click(screen.getByRole('button', { name: 'Save bank account' }));

    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();

    act(() => {
      release(null);
    });
    expect(await screen.findByRole('button', { name: 'Save bank account' })).toBeEnabled();
  });

  it('shows "Saving..." while the save mutation is pending', () => {
    setAccountState.isPending = true;
    loaded(null);
    render(page());

    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
  });

  it('explains that Stripe is not configured and disables saving', () => {
    stripeState.configured = false;
    loaded(null);
    render(page());

    expect(
      screen.getByText(/Connect a Stripe account before adding a payout bank account/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save bank account' })).toBeDisabled();
  });

  it('shows no configuration notice when Stripe is configured', () => {
    loaded(null);
    render(page());

    expect(screen.queryByText(/Connect a Stripe account/)).not.toBeInTheDocument();
  });
});
