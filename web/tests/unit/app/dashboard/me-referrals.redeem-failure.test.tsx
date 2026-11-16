// /me/referrals — a rejected redeem. handleRedeem awaited mutateAsync with no
// catch and was called as `void handleRedeem(e)`, so an invalid code became an
// unhandled rejection. The hook shows the error toast; the page must absorb
// the rejection and leave the code in the field.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { trackUnhandledRejections, unhandledRejections } from './_rejection-probe';

const redeem = vi.hoisted(() => vi.fn<(code: string) => Promise<unknown>>());

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/hooks/useReferrals', () => ({
  useReferralCode: () => ({ data: { code: 'MINE2345' }, isLoading: false, isError: false }),
  useMyReferrals: () => ({
    data: { referrals: [], credit_balance_cents: 0 },
    isLoading: false,
    isError: false,
  }),
  useRedeemReferral: () => ({ mutateAsync: redeem, isPending: false }),
}));

import ReferralsPage from '@/app/(dashboard)/me/referrals/page';

trackUnhandledRejections();

function submitCode(code: string) {
  const input = screen.getByLabelText('Referral code');
  fireEvent.change(input, { target: { value: code } });
  const form = input.closest('form');
  if (!form) throw new Error('expected the redeem form');
  fireEvent.submit(form);
}

beforeEach(() => {
  redeem.mockReset();
});

describe('ReferralsPage — redeeming a code', () => {
  it('absorbs a rejected redeem and keeps the code for correction', async () => {
    redeem.mockRejectedValue(new Error('code not found'));
    render(createElement(ReferralsPage));

    submitCode('abcd2345');

    await waitFor(() => {
      expect(redeem).toHaveBeenCalledWith('ABCD2345');
    });
    expect(await unhandledRejections()).toEqual([]);
    expect(screen.getByLabelText('Referral code')).toHaveProperty('value', 'ABCD2345');
  });

  it('clears the field after a successful redeem', async () => {
    redeem.mockResolvedValue({ message: 'ok' });
    render(createElement(ReferralsPage));

    submitCode('abcd2345');

    await waitFor(() => {
      expect(screen.getByLabelText('Referral code')).toHaveProperty('value', '');
    });
  });
});
