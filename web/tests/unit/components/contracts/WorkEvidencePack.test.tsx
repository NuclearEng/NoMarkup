import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkEvidencePack } from '@/components/contracts/WorkEvidencePack';
import type { WorkEvidence } from '@/hooks/useWorkEvidence';
import type { Payment } from '@/types';

const refetch = vi.fn();
const releaseMutate = vi.fn();

const evidenceState: {
  data: WorkEvidence | undefined;
  isLoading: boolean;
  isError: boolean;
} = {
  data: undefined,
  isLoading: false,
  isError: false,
};

const paymentsState: { data: { payments: Payment[] } | undefined } = {
  data: { payments: [] },
};

const releaseState: { isPending: boolean; isError: boolean } = {
  isPending: false,
  isError: false,
};

vi.mock('@/hooks/useWorkEvidence', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useWorkEvidence')>(
    '@/hooks/useWorkEvidence',
  );
  return {
    ...actual,
    useWorkEvidence: () => ({
      ...evidenceState,
      refetch,
    }),
  };
});

vi.mock('@/hooks/usePayments', () => ({
  usePayments: () => paymentsState,
  useReleaseEscrow: () => ({
    mutate: releaseMutate,
    get isPending() {
      return releaseState.isPending;
    },
    get isError() {
      return releaseState.isError;
    },
  }),
}));

const escrowPayment: Payment = {
  id: 'pmt-escrow',
  contract_id: 'c-1',
  customer_id: 'cust-1',
  provider_id: 'prov-1',
  amount_cents: 50000,
  platform_fee_cents: 0,
  guarantee_fee_cents: 0,
  provider_payout_cents: 50000,
  status: 'escrow',
  refund_amount_cents: 0,
  created_at: '2026-04-01T00:00:00Z',
};

function notReady(overrides: Partial<WorkEvidence> = {}): WorkEvidence {
  return {
    ready_for_release: false,
    missing: ['check_in', 'after_photo'],
    sessions: [],
    photos: [],
    ...overrides,
  };
}

describe('WorkEvidencePack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    evidenceState.data = notReady();
    evidenceState.isLoading = false;
    evidenceState.isError = false;
    paymentsState.data = { payments: [] };
    releaseState.isPending = false;
    releaseState.isError = false;
  });

  it('renders a loading skeleton', () => {
    evidenceState.isLoading = true;
    evidenceState.data = undefined;
    render(
      createElement(WorkEvidencePack, {
        contractId: 'c-1',
        isCustomer: true,
        isProvider: false,
      }),
    );
    expect(screen.getByLabelText(/Loading work evidence/i)).toBeDefined();
  });

  it('renders error + retry when the fetch fails', async () => {
    const user = userEvent.setup();
    evidenceState.isError = true;
    evidenceState.data = undefined;
    render(
      createElement(WorkEvidencePack, {
        contractId: 'c-1',
        isCustomer: true,
        isProvider: false,
      }),
    );
    expect(screen.getByText(/Could not load work evidence/i)).toBeDefined();
    await user.click(screen.getByRole('button', { name: /Retry/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it('lists missing items and empty sessions/photos', () => {
    render(
      createElement(WorkEvidencePack, {
        contractId: 'c-1',
        isCustomer: true,
        isProvider: false,
      }),
    );
    expect(screen.getByText(/Need check-in and an after photo before funds release/i)).toBeDefined();
    expect(screen.getByText('Check-in at the job site')).toBeDefined();
    expect(screen.getByText('After photo of completed work')).toBeDefined();
    expect(screen.getByText(/No check-in recorded yet/i)).toBeDefined();
    expect(screen.getByText(/No completion photos uploaded yet/i)).toBeDefined();
  });

  it('renders session times without coordinates', () => {
    evidenceState.data = notReady({
      missing: ['after_photo'],
      sessions: [
        {
          checked_in_at: '2026-04-10T14:00:00Z',
          checked_out_at: '2026-04-10T16:30:00Z',
          duration_minutes: 150,
        },
      ],
    });
    render(
      createElement(WorkEvidencePack, {
        contractId: 'c-1',
        isCustomer: true,
        isProvider: false,
      }),
    );
    expect(screen.getByText(/Checked in/i)).toBeDefined();
    expect(screen.getByText(/Checked out/i)).toBeDefined();
    expect(screen.getByText('2h 30m')).toBeDefined();
    expect(screen.queryByText(/lat/i)).toBeNull();
    expect(screen.queryByText(/lng/i)).toBeNull();
  });

  it('renders allowlisted photo thumbs and hides non-allowlisted hosts', () => {
    evidenceState.data = notReady({
      missing: ['check_in'],
      photos: [
        {
          phase: 'after',
          url: 'https://picsum.photos/id/1/200/200',
          uploaded_at: '2026-04-10T16:00:00Z',
        },
        {
          phase: 'before',
          url: 'https://evil.example.com/tracker.jpg',
          uploaded_at: '2026-04-10T12:00:00Z',
        },
      ],
    });
    const { container } = render(
      createElement(WorkEvidencePack, {
        contractId: 'c-1',
        isCustomer: true,
        isProvider: false,
      }),
    );
    const imgs = container.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0]?.getAttribute('src')).toBe('https://picsum.photos/id/1/200/200');
    expect(screen.getByText(/Before photo unavailable/i)).toBeDefined();
  });

  it('disables the customer release CTA until ready and lists missing items', () => {
    paymentsState.data = { payments: [escrowPayment] };
    render(
      createElement(WorkEvidencePack, {
        contractId: 'c-1',
        isCustomer: true,
        isProvider: false,
      }),
    );
    const button = screen.getByRole('button', { name: /Release escrow/i });
    expect(button).toHaveProperty('disabled', true);
    expect(screen.getAllByText(/Need check-in and an after photo before funds release/i).length).toBeGreaterThan(0);
  });

  it('releases escrow when ready and the customer clicks', async () => {
    const user = userEvent.setup();
    evidenceState.data = {
      ready_for_release: true,
      missing: [],
      sessions: [
        {
          checked_in_at: '2026-04-10T14:00:00Z',
          checked_out_at: '2026-04-10T16:00:00Z',
          duration_minutes: 120,
        },
      ],
      photos: [
        {
          phase: 'after',
          url: 'https://picsum.photos/id/2/200/200',
          uploaded_at: '2026-04-10T16:00:00Z',
        },
      ],
    };
    paymentsState.data = { payments: [escrowPayment] };
    render(
      createElement(WorkEvidencePack, {
        contractId: 'c-1',
        isCustomer: true,
        isProvider: false,
      }),
    );
    const button = screen.getByRole('button', { name: /Release escrow/i });
    expect(button).toHaveProperty('disabled', false);
    await user.click(button);
    expect(releaseMutate).toHaveBeenCalledWith(
      { paymentId: 'pmt-escrow', reason: 'customer approved completion' },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('shows a 409 missing message in the pack and does not claim success', async () => {
    const user = userEvent.setup();
    const { ApiError } = await import('@/lib/api');
    evidenceState.data = {
      ready_for_release: true,
      missing: [],
      sessions: [],
      photos: [],
    };
    paymentsState.data = { payments: [escrowPayment] };
    releaseMutate.mockImplementation(
      (
        _vars: unknown,
        opts?: { onError?: (err: unknown) => void },
      ) => {
        opts?.onError?.(
          new ApiError(
            409,
            JSON.stringify({
              error: 'proof of work required',
              missing: ['after_photo'],
            }),
          ),
        );
      },
    );

    render(
      createElement(WorkEvidencePack, {
        contractId: 'c-1',
        isCustomer: true,
        isProvider: false,
      }),
    );
    await user.click(screen.getByRole('button', { name: /Release escrow/i }));
    expect(screen.getByRole('alert').textContent).toMatch(/Need an after photo before funds release/i);
    expect(screen.queryByText(/Escrow released/i)).toBeNull();
  });

  it('does not show a release CTA to the provider', () => {
    paymentsState.data = { payments: [escrowPayment] };
    render(
      createElement(WorkEvidencePack, {
        contractId: 'c-1',
        isCustomer: false,
        isProvider: true,
      }),
    );
    expect(screen.queryByRole('button', { name: /Release escrow/i })).toBeNull();
    expect(screen.getByText(/You cannot release your own payout/i)).toBeDefined();
  });
});
