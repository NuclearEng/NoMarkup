import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GuaranteeClaimReview } from '@/components/admin/GuaranteeClaimReview';
import type { Dispute } from '@/types';

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver;
});

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => createElement('img', props),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

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

  it('shows a validation error when payout is zero on approve', async () => {
    const user = userEvent.setup();
    render(createElement(GuaranteeClaimReview, { claim: makeClaim() }));
    await user.type(screen.getByLabelText(/Resolution Notes/), 'Approving claim with full evidence.');
    await user.click(screen.getByRole('button', { name: /approve claim/i }));
    expect(screen.getByText(/Payout amount must be greater than \$0/)).toBeDefined();
    expect(mockReview).not.toHaveBeenCalled();
  });

  it('successfully approves with notes and payout', async () => {
    const user = userEvent.setup();
    const onResolved = vi.fn();
    render(
      createElement(GuaranteeClaimReview, {
        claim: makeClaim(),
        onResolved,
        contractAmountCents: 200_00,
      }),
    );
    await user.type(screen.getByLabelText(/Resolution Notes/), 'Approving with full payout.');
    await user.type(screen.getByLabelText(/Payout Amount/), '150.00');
    await user.click(screen.getByRole('button', { name: /approve claim/i }));
    expect(mockReview).toHaveBeenCalledWith({
      claimId: 'claim-1',
      approved: true,
      resolution_notes: 'Approving with full payout.',
      payout_cents: 15000,
    });
    expect(onResolved).toHaveBeenCalled();
  });

  it('renders contract value when contractAmountCents is provided', () => {
    render(
      createElement(GuaranteeClaimReview, {
        claim: makeClaim(),
        contractAmountCents: 5_000_00,
      }),
    );
    expect(screen.getByText(/Contract Value/)).toBeDefined();
    expect(screen.getAllByText(/\$5,000\.00/).length).toBeGreaterThan(0);
  });

  it('renders evidence photos when evidence_urls present on the claim', () => {
    render(
      createElement(GuaranteeClaimReview, {
        claim: {
          ...makeClaim(),
          evidence_urls: ['https://cdn/img1.png', 'https://cdn/img2.png'],
        } as Dispute,
      }),
    );
    expect(screen.getByText(/Evidence Photos/)).toBeDefined();
    const links = screen.getAllByRole('link');
    const evidenceLinks = links.filter(
      (a) => a.getAttribute('href')?.startsWith('https://cdn/'),
    );
    expect(evidenceLinks.length).toBe(2);
  });

  it('hides evidence section when no evidence URLs', () => {
    render(createElement(GuaranteeClaimReview, { claim: makeClaim() }));
    expect(screen.queryByText(/Evidence Photos/)).toBeNull();
  });

  it('reject dialog confirm button enables once a reason is typed', async () => {
    const user = userEvent.setup();
    render(createElement(GuaranteeClaimReview, { claim: makeClaim() }));
    await user.click(screen.getByRole('button', { name: /reject claim/i }));
    await user.type(
      screen.getByLabelText(/Rejection Reason/),
      'Insufficient evidence provided.',
    );
    const confirm = screen.getByRole<HTMLButtonElement>('button', { name: /confirm rejection/i });
    expect(confirm.disabled).toBe(false);
  });

  it('confirms rejection and calls mutateAsync with combined notes', async () => {
    const user = userEvent.setup();
    const onResolved = vi.fn();
    render(createElement(GuaranteeClaimReview, { claim: makeClaim(), onResolved }));
    // Fill resolution notes then open reject and supply reason
    await user.type(screen.getByLabelText(/Resolution Notes/), 'Reviewed thoroughly.');
    await user.click(screen.getByRole('button', { name: /reject claim/i }));
    await user.type(screen.getByLabelText(/Rejection Reason/), 'Photos do not match.');
    await user.click(screen.getByRole<HTMLButtonElement>('button', { name: /confirm rejection/i }));
    expect(mockReview).toHaveBeenCalledWith({
      claimId: 'claim-1',
      approved: false,
      resolution_notes: 'Reviewed thoroughly.\n\nRejection reason: Photos do not match.',
    });
    expect(onResolved).toHaveBeenCalled();
  });

  it('renders a payout amount summary when refund_amount_cents is set', () => {
    render(
      createElement(GuaranteeClaimReview, {
        claim: makeClaim({ refund_amount_cents: 10_000 }),
      }),
    );
    // Multiple "Payout Amount" labels appear (summary + form). Just check one exists.
    expect(screen.getAllByText(/Payout Amount/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\$100\.00/).length).toBeGreaterThan(0);
  });

  it('cancels the reject dialog via Cancel button', async () => {
    const user = userEvent.setup();
    render(createElement(GuaranteeClaimReview, { claim: makeClaim() }));
    await user.click(screen.getByRole('button', { name: /reject claim/i }));
    // Two cancel buttons may exist (dialog + maybe outer); locate dialog cancel by Region
    const cancels = screen.getAllByRole('button', { name: /^cancel$/i });
    await user.click(cancels[cancels.length - 1] as HTMLElement);
    // After cancel, the Rejection Reason label should disappear from the document
    expect(screen.queryByLabelText(/Rejection Reason/)).toBeNull();
  });
});
