import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GuaranteeClaimReview } from '@/components/admin/GuaranteeClaimReview';
import type { Dispute } from '@/types';

const mockReview = vi.fn().mockResolvedValue(undefined);

vi.mock('@/hooks/useGuarantee', () => ({
  useReviewGuaranteeClaim: () => ({
    mutateAsync: mockReview,
    isPending: false,
    isError: false,
  }),
}));

function makeClaim(overrides: Partial<Dispute> = {}): Dispute {
  return {
    id: 'claim-1',
    contract_id: 'contract-12345678',
    initiated_by: 'user-1',
    initiator_name: 'Alice',
    reason: 'Quality issue',
    status: 'open',
    is_guarantee_claim: true,
    created_at: '2026-04-01T12:00:00Z',
    ...overrides,
  };
}

describe('GuaranteeClaimReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders claim header and details', () => {
    render(createElement(GuaranteeClaimReview, { claim: makeClaim() }));
    expect(screen.getByText('Guarantee Claim')).toBeDefined();
    expect(screen.getByText('Claim Details')).toBeDefined();
    expect(screen.getByText('Open')).toBeDefined();
  });

  it('shows Approve and Reject buttons when claim is open', () => {
    render(createElement(GuaranteeClaimReview, { claim: makeClaim() }));
    expect(screen.getByRole('button', { name: /approve claim/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /reject claim/i })).toBeDefined();
  });

  it('hides the review panel when claim is resolved', () => {
    render(
      createElement(GuaranteeClaimReview, {
        claim: makeClaim({ status: 'resolved', resolved_at: '2026-04-10T00:00:00Z' }),
      }),
    );
    expect(screen.queryByRole('button', { name: /approve claim/i })).toBeNull();
  });

  it('shows a validation error when approving without notes', async () => {
    const user = userEvent.setup();
    render(createElement(GuaranteeClaimReview, { claim: makeClaim() }));
    await user.click(screen.getByRole('button', { name: /approve claim/i }));
    expect(screen.getByRole('alert')).toBeDefined();
    expect(mockReview).not.toHaveBeenCalled();
  });

  it('opens the reject dialog and disables confirm without a reason', async () => {
    const user = userEvent.setup();
    render(createElement(GuaranteeClaimReview, { claim: makeClaim() }));
    await user.click(screen.getByRole('button', { name: /reject claim/i }));
    // Dialog opens; the Confirm Rejection button starts disabled.
    const confirm = screen.getByRole<HTMLButtonElement>('button', { name: /confirm rejection/i });
    expect(confirm.disabled).toBe(true);
  });
});
