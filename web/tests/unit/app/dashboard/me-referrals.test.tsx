// /me/referrals — referral code card (copy code / share link), redeem form
// and the referrals table. Hooks, sonner and the clipboard are mocked.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

interface ReferralRow {
  id: string;
  status: string;
  credit_cents: number;
  created_at: string;
}

const codeState: {
  data: { code: string; credit_cents: number; share_url: string; share_message: string } | undefined;
  isLoading: boolean;
} = { data: undefined, isLoading: false };

const listState: {
  data: { code: string; referrals: ReferralRow[]; credit_balance_cents: number } | undefined;
  isLoading: boolean;
} = { data: undefined, isLoading: false };

const redeemMutateAsync = vi.fn<(code: string) => Promise<unknown>>();
const redeemState = { mutateAsync: redeemMutateAsync, isPending: false };

const toastSuccess = vi.fn<(message: string) => void>();
const toastError = vi.fn<(message: string) => void>();
const writeText = vi.fn<(text: string) => Promise<void>>();

vi.mock('sonner', () => ({
  toast: {
    success: (message: string) => {
      toastSuccess(message);
    },
    error: (message: string) => {
      toastError(message);
    },
  },
}));

vi.mock('@/hooks/useReferrals', () => ({
  useReferralCode: () => codeState,
  useMyReferrals: () => listState,
  useRedeemReferral: () => redeemState,
}));

import ReferralsPage from '@/app/(dashboard)/me/referrals/page';

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

function renderPage() {
  return render(withQueryClient(createElement(ReferralsPage)));
}

const code = {
  code: 'ABCD2345',
  credit_cents: 1000,
  share_url: 'https://no-markup.com/r/ABCD2345',
  share_message: 'Join me on NoMarkup and get $10 off.',
};

const codeInput = () => screen.getByLabelText('Referral code');

function redeemForm(): HTMLFormElement {
  const form = codeInput().closest('form');
  if (!form) throw new Error('redeem form not found');
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  codeState.data = undefined;
  codeState.isLoading = false;
  listState.data = undefined;
  listState.isLoading = false;
  redeemState.isPending = false;
  redeemMutateAsync.mockResolvedValue({ redeemed: true });
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

afterEach(() => {
  if (originalClipboard) {
    Object.defineProperty(navigator, 'clipboard', originalClipboard);
  } else {
    Reflect.deleteProperty(navigator, 'clipboard');
  }
});

describe('ReferralsPage — code card', () => {
  it('shows a loading line and no copy buttons while the code loads', () => {
    codeState.isLoading = true;
    listState.isLoading = true;
    renderPage();

    expect(screen.getAllByText('Loading…')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Copy code' })).toBeNull();
    expect(screen.queryByText('Could not load your code. Try again.')).toBeNull();
  });

  it('shows the failure copy when the code query settles without data', () => {
    renderPage();

    expect(screen.getByText('Could not load your code. Try again.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy share link' })).toBeNull();
  });

  it('shows the code, share message and a $0.00 balance when the ledger has not loaded', () => {
    codeState.data = code;
    renderPage();

    expect(screen.getByText('ABCD2345')).toBeInTheDocument();
    expect(screen.getByText('Join me on NoMarkup and get $10 off.')).toBeInTheDocument();
    expect(screen.getByText(/Available credit:/)).toHaveTextContent('Available credit: $0.00');
  });

  it('shows the credit balance from the referral ledger', () => {
    codeState.data = code;
    listState.data = { code: 'ABCD2345', referrals: [], credit_balance_cents: 123456 };
    renderPage();

    expect(screen.getByText(/Available credit:/)).toHaveTextContent('Available credit: $1,234.56');
  });

  it('copies the code and confirms with a toast', async () => {
    codeState.data = code;
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith('Code copied');
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith('ABCD2345');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('reports a failed code copy with an error toast', async () => {
    codeState.data = code;
    writeText.mockRejectedValue(new Error('denied'));
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Could not copy');
    });
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('copies the share URL (not the bare code) and confirms with a toast', async () => {
    codeState.data = code;
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Copy share link' }));

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith('Link copied');
    });
    expect(writeText).toHaveBeenCalledWith('https://no-markup.com/r/ABCD2345');
  });

  it('tells the user to copy manually when the share link copy fails', async () => {
    codeState.data = code;
    writeText.mockRejectedValue(new Error('denied'));
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Copy share link' }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Could not copy — tap and hold to copy manually');
    });
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe('ReferralsPage — redeem form', () => {
  it('keeps Redeem disabled until a non-blank code is typed', () => {
    renderPage();
    const button = screen.getByRole('button', { name: 'Redeem' });
    expect(button).toBeDisabled();

    fireEvent.change(codeInput(), { target: { value: '   ' } });
    expect(button).toBeDisabled();

    fireEvent.change(codeInput(), { target: { value: 'x' } });
    expect(button).toBeEnabled();
  });

  it('upper-cases the code as it is typed', () => {
    renderPage();
    fireEvent.change(codeInput(), { target: { value: 'abcd2345' } });
    expect(codeInput()).toHaveValue('ABCD2345');
  });

  it('redeems the trimmed, upper-cased code and clears the input afterwards', async () => {
    renderPage();
    fireEvent.change(codeInput(), { target: { value: '  wxyz9876 ' } });
    fireEvent.submit(redeemForm());

    await waitFor(() => {
      expect(codeInput()).toHaveValue('');
    });
    expect(redeemMutateAsync).toHaveBeenCalledTimes(1);
    expect(redeemMutateAsync).toHaveBeenCalledWith('WXYZ9876');
  });

  it('does not call the mutation when a blank code is submitted', () => {
    renderPage();
    fireEvent.change(codeInput(), { target: { value: '   ' } });
    fireEvent.submit(redeemForm());

    expect(redeemMutateAsync).not.toHaveBeenCalled();
    expect(codeInput()).toHaveValue('   ');
  });

  it('disables the button and shows "Redeeming…" while the mutation is pending', () => {
    redeemState.isPending = true;
    renderPage();
    fireEvent.change(codeInput(), { target: { value: 'ABCD' } });

    expect(screen.getByRole('button', { name: 'Redeeming…' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Redeem' })).toBeNull();
  });

  // A rejected redeem: see me-referrals.redeem-failure.test.tsx.
});

describe('ReferralsPage — referrals table', () => {
  it('shows a loading line while referrals load', () => {
    codeState.data = code;
    listState.isLoading = true;
    renderPage();

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText(/No referrals yet/)).toBeNull();
  });

  it('shows the empty copy when the ledger has not loaded', () => {
    renderPage();
    expect(screen.getByText('No referrals yet. Share your code to get started.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows the empty copy for an empty referral list', () => {
    listState.data = { code: 'ABCD2345', referrals: [], credit_balance_cents: 0 };
    renderPage();
    expect(screen.getByText('No referrals yet. Share your code to get started.')).toBeInTheDocument();
  });

  it('renders one row per referral with humanised status, credit and join date', () => {
    listState.data = {
      code: 'ABCD2345',
      credit_balance_cents: 1000,
      referrals: [
        { id: 'r-1', status: 'pending_first_transaction', credit_cents: 0, created_at: '2026-03-04T12:00:00Z' },
        { id: 'r-2', status: 'credited', credit_cents: 1000, created_at: '2026-05-06T12:00:00Z' },
      ],
    };
    renderPage();

    const table = screen.getByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Status', 'Credit', 'Joined']);

    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Pending First Transaction');
    expect(rows[0]).toHaveTextContent('$0.00');
    expect(rows[0]).toHaveTextContent(new Date('2026-03-04T12:00:00Z').toLocaleDateString());
    expect(rows[1]).toHaveTextContent('Credited');
    expect(rows[1]).toHaveTextContent('$10.00');
    expect(rows[1]).toHaveTextContent(new Date('2026-05-06T12:00:00Z').toLocaleDateString());
    expect(screen.queryByText(/No referrals yet/)).toBeNull();
  });
});
