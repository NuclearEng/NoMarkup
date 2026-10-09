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
const mutationState = { isPending: false, isError: false };

vi.mock('@/hooks/useGuarantee', () => ({
  useReviewGuaranteeClaim: () => ({
    mutateAsync: mockReview,
    get isPending() {
      return mutationState.isPending;
    },
    get isError() {
      return mutationState.isError;
    },
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
    mutationState.isPending = false;
    mutationState.isError = false;
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

  // ---- DEEPENING: reviewMutation.isError branches (lines 322-324, 377-379) ----

  it('renders the main-panel review error message when the mutation errors', () => {
    mutationState.isError = true;
    render(createElement(GuaranteeClaimReview, { claim: makeClaim() }));
    expect(screen.getByText(/Failed to submit review/)).toBeDefined();
  });

  it('renders the reject-dialog error message when the mutation errors', async () => {
    mutationState.isError = true;
    const user = userEvent.setup();
    render(createElement(GuaranteeClaimReview, { claim: makeClaim() }));
    await user.click(screen.getByRole('button', { name: /reject claim/i }));
    expect(screen.getByText(/Failed to reject claim/)).toBeDefined();
  });

  it('disables Approve and Reject buttons while the mutation is pending', () => {
    mutationState.isPending = true;
    render(createElement(GuaranteeClaimReview, { claim: makeClaim() }));
    const approve = screen.getByRole<HTMLButtonElement>('button', { name: /Processing|Approve Claim/i });
    const reject = screen.getByRole<HTMLButtonElement>('button', { name: /reject claim/i });
    expect(approve.disabled).toBe(true);
    expect(reject.disabled).toBe(true);
  });

  it('shows "Processing..." label on Approve while pending', () => {
    mutationState.isPending = true;
    render(createElement(GuaranteeClaimReview, { claim: makeClaim() }));
    expect(screen.getByText(/Processing\.\.\./)).toBeDefined();
  });

  it('renders Resolved label when claim status is resolved', () => {
    render(
      createElement(GuaranteeClaimReview, {
        claim: makeClaim({ status: 'resolved', resolved_at: '2026-04-12T10:00:00Z' }),
      }),
    );
    // "Resolved" appears as the status badge AND the resolved-at field label.
    expect(screen.getAllByText('Resolved').length).toBeGreaterThanOrEqual(1);
  });

  it('renders Resolution Notes summary when notes are present', () => {
    render(
      createElement(GuaranteeClaimReview, {
        claim: makeClaim({
          status: 'resolved',
          resolution_notes: 'Approved with full payout.',
          resolved_at: '2026-04-10T00:00:00Z',
        }),
      }),
    );
    expect(screen.getByText(/Resolution Notes/)).toBeDefined();
    expect(screen.getByText('Approved with full payout.')).toBeDefined();
  });

  it('renders the Outcome label when guarantee_outcome is set', () => {
    render(
      createElement(GuaranteeClaimReview, {
        claim: makeClaim({ guarantee_outcome: 'refund' }),
      }),
    );
    expect(screen.getByText('Refund Issued')).toBeDefined();
  });

  it('hides the review panel when status is closed', () => {
    render(
      createElement(GuaranteeClaimReview, {
        claim: makeClaim({ status: 'closed' as Dispute['status'] }),
      }),
    );
    expect(screen.queryByRole('button', { name: /approve claim/i })).toBeNull();
  });

  // ---- WAVE 21 BRANCH-DEEPENING ----

  it('falls back to the raw status string when status has no STATUS_LABELS entry', () => {
    render(
      createElement(GuaranteeClaimReview, {
        claim: makeClaim({ status: 'unknown_status' as Dispute['status'] }),
      }),
    );
    // Badge shows the raw status value (no label match → fall through).
    expect(screen.getByText('unknown_status')).toBeDefined();
  });

  it('falls back to the truncated initiator id when initiator_name is missing', () => {
    render(
      createElement(GuaranteeClaimReview, {
        claim: makeClaim({
          initiator_name: undefined,
          initiated_by: 'abcdef123456789xyz',
        }),
      }),
    );
    // First 12 chars of initiated_by are shown when initiator_name absent.
    expect(screen.getByText('abcdef123456')).toBeDefined();
  });

  it('falls back to the raw outcome string when guarantee_outcome is unknown', () => {
    render(
      createElement(GuaranteeClaimReview, {
        claim: makeClaim({ guarantee_outcome: 'partial_refund' as Dispute['guarantee_outcome'] }),
      }),
    );
    // Unknown outcome falls through to the raw value.
    expect(screen.getByText('partial_refund')).toBeDefined();
  });

  it('confirms rejection with reason-only notes when resolution notes are blank', async () => {
    const user = userEvent.setup();
    const onResolved = vi.fn();
    render(createElement(GuaranteeClaimReview, { claim: makeClaim(), onResolved }));
    // Open reject dialog without typing into Resolution Notes.
    await user.click(screen.getByRole('button', { name: /reject claim/i }));
    await user.type(
      screen.getByLabelText(/Rejection Reason/),
      'Insufficient evidence supplied.',
    );
    await user.click(
      screen.getByRole<HTMLButtonElement>('button', { name: /confirm rejection/i }),
    );
    // combinedNotes uses the rejection reason only (no leading resolution notes).
    expect(mockReview).toHaveBeenCalledWith({
      claimId: 'claim-1',
      approved: false,
      resolution_notes: 'Insufficient evidence supplied.',
    });
    expect(onResolved).toHaveBeenCalled();
  });
});
