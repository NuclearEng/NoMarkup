// /admin/banking — the backend rejects the tokenized bank account. The submit
// handler had try/finally but no catch and was called as `void handleSubmit()`,
// so the rejection went unhandled. The hook shows the error toast; the page
// must absorb the rejection and keep the form filled in for a retry.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { trackUnhandledRejections, unhandledRejections } from './_rejection-probe';

const h = vi.hoisted(() => ({
  setAccount: vi.fn<(vars: unknown) => Promise<unknown>>(),
  createToken: vi.fn<(type: string, data: unknown) => Promise<unknown>>(),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/hooks/useAdmin', () => ({
  usePlatformBanking: () => ({ data: { accounts: [] }, isLoading: false, isError: false }),
  useSetPlatformBankAccount: () => ({ mutateAsync: h.setAccount, isPending: false }),
  useDeletePlatformBankAccount: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/lib/stripe', () => ({
  isStripeConfigured: () => true,
  getStripe: () => Promise.resolve({ createToken: h.createToken }),
}));
vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
  SelectContent: () => null,
  SelectItem: () => null,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

import AdminBankingPage from '@/app/(dashboard)/admin/banking/page';

trackUnhandledRejections();

function fillAndSave() {
  fireEvent.change(screen.getByLabelText('Account holder name'), { target: { value: 'NoMarkup Inc.' } });
  fireEvent.change(screen.getByLabelText('Routing number'), { target: { value: '110000000' } });
  fireEvent.change(screen.getByLabelText('Account number'), { target: { value: '000123456789' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save bank account' }));
}

beforeEach(() => {
  h.setAccount.mockReset();
  h.createToken.mockReset().mockResolvedValue({ token: { id: 'btok_123' } });
});

describe('AdminBankingPage — saving the payout account', () => {
  it('absorbs a rejected save and keeps the form filled in', async () => {
    h.setAccount.mockRejectedValue(new Error('bank account rejected'));
    render(createElement(AdminBankingPage));

    fillAndSave();

    await waitFor(() => {
      expect(h.setAccount).toHaveBeenCalledTimes(1);
    });
    expect(h.setAccount.mock.calls[0]?.[0]).toMatchObject({
      bank_account_token: 'btok_123',
      account_holder_name: 'NoMarkup Inc.',
    });
    expect(await unhandledRejections()).toEqual([]);
    expect(screen.getByLabelText('Account holder name')).toHaveProperty('value', 'NoMarkup Inc.');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save bank account' })).toBeDefined();
    });
  });

  it('clears the sensitive fields after a successful save', async () => {
    h.setAccount.mockResolvedValue({});
    render(createElement(AdminBankingPage));

    fillAndSave();

    await waitFor(() => {
      expect(screen.getByLabelText('Account holder name')).toHaveProperty('value', '');
    });
    expect(screen.getByLabelText('Routing number')).toHaveProperty('value', '');
    expect(screen.getByLabelText('Account number')).toHaveProperty('value', '');
  });
});
