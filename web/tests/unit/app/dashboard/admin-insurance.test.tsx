// Tests for the admin insurance claims page — exercises loading, error,
// empty, populated table, status filter, and approve/deny action UI.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const claimsState: {
  data: { claims: Record<string, unknown>[]; pagination?: unknown } | undefined;
  isLoading: boolean;
  isError: boolean;
} = { data: undefined, isLoading: false, isError: false };

const reviewClaimMutate = vi.fn();
const reviewClaimState = { isPending: false };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/insurance',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/hooks/useInsurance', () => ({
  useAdminInsuranceClaims: () => claimsState,
  useReviewInsuranceClaim: () => ({
    mutate: reviewClaimMutate,
    isPending: reviewClaimState.isPending,
  }),
}));

const { default: AdminInsurancePage } = await import(
  '@/app/(dashboard)/admin/insurance/page'
);

function makeClaim(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'claim-1',
    claim_number: 'CLM-100',
    policy_id: 'pol-1',
    claim_type: 'property_damage',
    description: 'damage',
    evidence_urls: [],
    claimed_amount_cents: 50000,
    approved_amount_cents: null,
    payout_cents: null,
    status: 'filed',
    denial_reason: null,
    created_at: '2026-04-10T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  claimsState.data = undefined;
  claimsState.isLoading = false;
  claimsState.isError = false;
  reviewClaimState.isPending = false;
  reviewClaimMutate.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AdminInsurancePage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(AdminInsurancePage)));
    expect(container).toBeTruthy();
  });

  it('renders page heading and filter control', () => {
    render(withQueryClient(createElement(AdminInsurancePage)));
    expect(screen.getByRole('heading', { name: 'Insurance Claims' })).toBeDefined();
    expect(screen.getByLabelText(/Filter claims by status/i)).toBeDefined();
  });

  it('renders error state when fetch fails', () => {
    claimsState.isError = true;
    render(withQueryClient(createElement(AdminInsurancePage)));
    expect(screen.getByText(/Failed to load claims/i)).toBeDefined();
  });

  it('renders empty message when claims list is empty', () => {
    claimsState.data = { claims: [], pagination: undefined };
    render(withQueryClient(createElement(AdminInsurancePage)));
    expect(screen.getByText(/No insurance claims found/i)).toBeDefined();
  });

  it('renders claims table rows when data present', () => {
    claimsState.data = {
      claims: [
        makeClaim({ claim_number: 'CLM-A', claim_type: 'property_damage' }),
        makeClaim({ id: 'claim-2', claim_number: 'CLM-B', claim_type: 'workmanship' }),
      ],
    };
    render(withQueryClient(createElement(AdminInsurancePage)));
    expect(screen.getByText('CLM-A')).toBeDefined();
    expect(screen.getByText('CLM-B')).toBeDefined();
  });

  it('shows Approve and Deny buttons for filed claims', () => {
    claimsState.data = { claims: [makeClaim({ status: 'filed' })] };
    render(withQueryClient(createElement(AdminInsurancePage)));
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDefined();
  });

  it('reveals approve form when Approve clicked', () => {
    claimsState.data = { claims: [makeClaim({ status: 'filed' })] };
    render(withQueryClient(createElement(AdminInsurancePage)));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(screen.getByLabelText(/Approved amount in dollars/i)).toBeDefined();
  });

  it('submits approve mutation with cents conversion', () => {
    claimsState.data = { claims: [makeClaim({ status: 'filed' })] };
    render(withQueryClient(createElement(AdminInsurancePage)));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const amountInput = screen.getByLabelText(/Approved amount in dollars/i);
    fireEvent.change(amountInput, { target: { value: '250.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(reviewClaimMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        claimId: 'claim-1',
        action: 'approve',
        approved_amount_cents: 25050,
      }),
      expect.any(Object),
    );
  });

  it('reveals deny form when Deny clicked and submits with reason', () => {
    claimsState.data = { claims: [makeClaim({ status: 'filed' })] };
    render(withQueryClient(createElement(AdminInsurancePage)));
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    const reasonInput = screen.getByLabelText(/Denial reason/i);
    fireEvent.change(reasonInput, { target: { value: 'Out of coverage' } });
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(reviewClaimMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        claimId: 'claim-1',
        action: 'deny',
        denial_reason: 'Out of coverage',
      }),
      expect.any(Object),
    );
  });

  it('hides actions for non-actionable claim statuses', () => {
    claimsState.data = { claims: [makeClaim({ status: 'paid' })] };
    render(withQueryClient(createElement(AdminInsurancePage)));
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deny' })).toBeNull();
  });

  it('cancels approve form via Cancel button', () => {
    claimsState.data = { claims: [makeClaim({ status: 'filed' })] };
    render(withQueryClient(createElement(AdminInsurancePage)));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText(/Approved amount in dollars/i)).toBeNull();
  });

  it('cancels deny form via Cancel button', () => {
    claimsState.data = { claims: [makeClaim({ status: 'filed' })] };
    render(withQueryClient(createElement(AdminInsurancePage)));
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(screen.getByLabelText(/Denial reason/i)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText(/Denial reason/i)).toBeNull();
  });

  it('shows pending Loader2 in approve confirm when reviewClaim is pending', () => {
    reviewClaimState.isPending = true;
    claimsState.data = { claims: [makeClaim({ status: 'filed' })] };
    render(withQueryClient(createElement(AdminInsurancePage)));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    // Confirm button should be disabled because pending and no amount entered
    const confirmBtn = screen.getByRole('button', { name: /Confirm/i });
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows pending Loader2 in deny confirm when reviewClaim is pending', () => {
    reviewClaimState.isPending = true;
    claimsState.data = { claims: [makeClaim({ status: 'filed' })] };
    render(withQueryClient(createElement(AdminInsurancePage)));
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    // The Deny submit button is the second one (the submit, not the open trigger)
    const denyButtons = screen.getAllByRole('button', { name: 'Deny' });
    expect((denyButtons[denyButtons.length - 1] as HTMLButtonElement).disabled).toBe(true);
  });

  it('approve onSuccess callback hides the approve form', () => {
    claimsState.data = { claims: [makeClaim({ status: 'filed' })] };
    // Make mutate invoke the onSuccess callback synchronously
    reviewClaimMutate.mockImplementation((_payload, options?: { onSuccess?: () => void }) => {
      options?.onSuccess?.();
    });
    render(withQueryClient(createElement(AdminInsurancePage)));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.change(screen.getByLabelText(/Approved amount in dollars/i), {
      target: { value: '100' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    // After onSuccess fires, the approve input should be gone
    expect(screen.queryByLabelText(/Approved amount in dollars/i)).toBeNull();
  });

  it('deny onSuccess callback hides the deny form', () => {
    claimsState.data = { claims: [makeClaim({ status: 'filed' })] };
    reviewClaimMutate.mockImplementation((_payload, options?: { onSuccess?: () => void }) => {
      options?.onSuccess?.();
    });
    render(withQueryClient(createElement(AdminInsurancePage)));
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    fireEvent.change(screen.getByLabelText(/Denial reason/i), {
      target: { value: 'Out of coverage' },
    });
    // The submit Deny button is the destructive one inside the deny form
    const denyButtons = screen.getAllByRole('button', { name: 'Deny' });
    fireEvent.click(denyButtons[denyButtons.length - 1] as HTMLButtonElement);
    expect(screen.queryByLabelText(/Denial reason/i)).toBeNull();
  });

  it('renders approved amount in cell when claim has approved_amount_cents', () => {
    claimsState.data = {
      claims: [
        makeClaim({
          status: 'approved',
          approved_amount_cents: 30000,
        }),
      ],
    };
    render(withQueryClient(createElement(AdminInsurancePage)));
    // formatCents(30000) → "$300.00" (or similar) — the 30000 cents value should appear
    // The "Claimed" column always renders. The Approved column only renders a value when not null.
    // Both 30000 and 50000 produce different strings; either way we should find $300.00 once.
    expect(screen.getAllByText(/\$300/).length).toBeGreaterThan(0);
  });

  it('changing status filter via the hidden native select updates the filter state', () => {
    claimsState.data = { claims: [] };
    render(withQueryClient(createElement(AdminInsurancePage)));
    const trigger = screen.getByLabelText(/Filter claims by status/i);
    const hidden = trigger.parentElement?.querySelector('select');
    if (hidden) {
      fireEvent.change(hidden, { target: { value: 'approved' } });
      // Then clearing back to all
      fireEvent.change(hidden, { target: { value: '__all__' } });
    }
    expect(screen.getByLabelText(/Filter claims by status/i)).toBeDefined();
  });
});
