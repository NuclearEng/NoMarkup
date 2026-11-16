import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkEvidencePack } from '@/components/contracts/WorkEvidencePack';
import type { WorkEvidence } from '@/hooks/useWorkEvidence';
import { ApiError } from '@/lib/api';
import type { Payment } from '@/types';

// MOCKED: useWorkEvidence, usePayments, useReleaseEscrow. PROVEN: session
// duration/timestamp formatting, photo phase labels, the null-slice wire
// shape, which payments get a release CTA, and release failure copy.

interface ReleaseOptions {
  onError?: (err: unknown) => void;
}

const h = vi.hoisted(() => ({
  evidence: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  payments: { data: undefined as unknown },
  release: {
    mutate: vi.fn<(vars: { paymentId: string; reason: string }, opts?: ReleaseOptions) => void>(),
    isPending: false,
  },
}));

vi.mock('@/hooks/useWorkEvidence', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useWorkEvidence')>(
    '@/hooks/useWorkEvidence',
  );
  return { ...actual, useWorkEvidence: () => h.evidence };
});

vi.mock('@/hooks/usePayments', () => ({
  usePayments: () => h.payments,
  useReleaseEscrow: () => h.release,
}));

function makePayment(over: Partial<Payment> = {}): Payment {
  return {
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
    ...over,
  };
}

function setEvidence(evidence: WorkEvidence) {
  h.evidence.data = evidence;
}

function setPayments(payments: Payment[]) {
  h.payments.data = { payments };
}

function renderPack(role: 'customer' | 'provider' = 'customer') {
  return render(
    <WorkEvidencePack
      contractId="c-1"
      isCustomer={role === 'customer'}
      isProvider={role === 'provider'}
    />,
  );
}

function localStamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const READY: WorkEvidence = { ready_for_release: true, missing: [], sessions: [], photos: [] };

beforeEach(() => {
  h.evidence.data = undefined;
  h.evidence.isLoading = false;
  h.evidence.isError = false;
  h.evidence.refetch.mockReset();
  h.payments.data = undefined;
  h.release.mutate.mockReset();
  h.release.isPending = false;
});

describe('WorkEvidencePack — sessions', () => {
  it('formats durations as minutes, hours+minutes, and zero', () => {
    setEvidence({
      ...READY,
      sessions: [
        {
          checked_in_at: '2026-04-10T14:00:00Z',
          checked_out_at: '2026-04-10T14:45:00Z',
          duration_minutes: 45,
        },
        {
          checked_in_at: '2026-04-11T14:00:00Z',
          checked_out_at: '2026-04-11T15:30:00Z',
          duration_minutes: 90,
        },
        {
          checked_in_at: '2026-04-12T14:00:00Z',
          checked_out_at: '2026-04-12T16:00:00Z',
          duration_minutes: 120,
        },
        {
          checked_in_at: '2026-04-13T14:00:00Z',
          checked_out_at: '2026-04-13T14:00:00Z',
          duration_minutes: 0,
        },
      ],
    });
    renderPack();

    const rows = within(screen.getByRole('region', { name: 'Work sessions' })).getAllByRole(
      'listitem',
    );
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent('45 min');
    expect(rows[1]).toHaveTextContent('1h 30m');
    expect(rows[2]).toHaveTextContent('2h 0m');
    expect(rows[3]).toHaveTextContent('0 min');
    expect(rows[0]).toHaveTextContent(`Checked in ${localStamp('2026-04-10T14:00:00Z')}`);
    expect(rows[0]).toHaveTextContent(`Checked out ${localStamp('2026-04-10T14:45:00Z')}`);
  });

  it('shows an open session as still on site, ignoring its duration', () => {
    setEvidence({
      ...READY,
      sessions: [
        { checked_in_at: '2026-04-10T14:00:00Z', checked_out_at: null, duration_minutes: 999 },
      ],
    });
    renderPack();

    const row = within(screen.getByRole('region', { name: 'Work sessions' })).getByRole(
      'listitem',
    );
    expect(row).toHaveTextContent('Still on site');
    expect(row).toHaveTextContent('In progress');
    expect(row).not.toHaveTextContent('Checked out');
    expect(row).not.toHaveTextContent('16h');
  });

  it('prints an unparseable timestamp verbatim instead of "Invalid Date"', () => {
    setEvidence({
      ...READY,
      sessions: [
        { checked_in_at: 'sometime tuesday', checked_out_at: null, duration_minutes: 0 },
      ],
    });
    renderPack();
    expect(screen.getByText('sometime tuesday')).toBeInTheDocument();
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
  });
});

describe('WorkEvidencePack — photos', () => {
  it('labels before, after and unknown phases, with and without an upload time', () => {
    setEvidence({
      ...READY,
      photos: [
        { phase: 'before', url: 'https://picsum.photos/id/1/200/200', uploaded_at: '' },
        {
          phase: 'after',
          url: 'https://picsum.photos/id/2/200/200',
          uploaded_at: '2026-04-10T16:00:00Z',
        },
        { phase: 'during', url: 'https://evil.invalid/x.jpg', uploaded_at: '' },
      ],
    });
    renderPack();

    expect(
      screen.getByRole('img', { name: 'Before shot of the completed work' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'After shot of the completed work' })).toHaveAttribute(
      'src',
      'https://picsum.photos/id/2/200/200',
    );
    // Non-allowlisted host: no <img>, generic phase label.
    expect(screen.getByText('during photo unavailable')).toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(2);

    const items = within(screen.getByRole('region', { name: /Completion photos/ })).getAllByRole(
      'listitem',
    );
    expect(items[0]).toHaveTextContent(/^Before$/);
    expect(items[1]).toHaveTextContent(`After · ${localStamp('2026-04-10T16:00:00Z')}`);
  });
});

describe('WorkEvidencePack — wire shape', () => {
  it('treats null slices from the gateway as empty and names both requirements', () => {
    setEvidence({ ready_for_release: false, missing: null, sessions: null, photos: null });
    setPayments([makePayment()]);
    renderPack();

    expect(screen.getByText('No check-in recorded yet.')).toBeInTheDocument();
    expect(screen.getByText('No completion photos uploaded yet.')).toBeInTheDocument();
    // No checklist (nothing listed as missing), but the CTA still explains itself.
    expect(screen.queryByText('Check-in at the job site')).toBeNull();
    expect(screen.getByRole('button', { name: /Release escrow/ })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Need check-in and an after photo before funds release',
    );
    expect(screen.queryByText('Check-in and after photo are on file.')).toBeNull();
  });

  it('humanises an unknown missing token in the sentence and the checklist', () => {
    setEvidence({ ready_for_release: false, missing: ['signed_waiver'], sessions: [], photos: [] });
    renderPack();
    expect(screen.getByText('Need signed waiver before funds release')).toBeInTheDocument();
    expect(screen.getByRole('listitem')).toHaveTextContent('signed waiver');
  });

  it('shows the error card when the fetch succeeded with no body', () => {
    renderPack();
    expect(screen.getByText('Could not load work evidence. Please try again.')).toBeInTheDocument();
  });
});

describe('WorkEvidencePack — release', () => {
  it('offers release only for this contract’s escrow payments, one CTA each', () => {
    setEvidence(READY);
    setPayments([
      makePayment({ id: 'p-1', amount_cents: 12345 }),
      makePayment({ id: 'p-2', amount_cents: 500 }),
      makePayment({ id: 'p-other', contract_id: 'c-2', amount_cents: 99900 }),
      makePayment({ id: 'p-released', status: 'released', amount_cents: 77700 }),
    ]);
    renderPack();

    const buttons = screen.getAllByRole('button', { name: /Release escrow/ });
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveTextContent('Release escrow · $123.45');
    expect(buttons[1]).toHaveTextContent('Release escrow · $5.00');
    expect(screen.getByText('Check-in and after photo are on file.')).toBeInTheDocument();
  });

  it('releases the payment whose button was pressed', async () => {
    setEvidence(READY);
    setPayments([makePayment({ id: 'p-1' }), makePayment({ id: 'p-2', amount_cents: 500 })]);
    const user = userEvent.setup();
    renderPack();

    await user.click(screen.getByRole('button', { name: 'Release escrow · $5.00' }));
    expect(h.release.mutate).toHaveBeenCalledTimes(1);
    expect(h.release.mutate.mock.calls[0]?.[0]).toEqual({
      paymentId: 'p-2',
      reason: 'customer approved completion',
    });
  });

  it('shows no CTA when there is no escrow payment or payments have not loaded', () => {
    setEvidence(READY);
    const { unmount } = renderPack();
    expect(screen.queryByRole('button', { name: /Release escrow/ })).toBeNull();
    unmount();

    setPayments([]);
    renderPack('provider');
    expect(screen.queryByText(/cannot release your own payout/)).toBeNull();
  });

  it('disables the CTA while a release is in flight', () => {
    setEvidence(READY);
    setPayments([makePayment()]);
    h.release.isPending = true;
    renderPack();
    const button = screen.getByRole('button', { name: /Release escrow/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });

  it('shows the server reason for a non-proof-of-work failure and clears it on retry', async () => {
    setEvidence(READY);
    setPayments([makePayment()]);
    h.release.mutate.mockImplementationOnce((_vars, opts) => {
      opts?.onError?.(new ApiError(403, JSON.stringify({ error: 'payment is on hold' })));
    });
    const user = userEvent.setup();
    renderPack();

    await user.click(screen.getByRole('button', { name: /Release escrow/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('payment is on hold');

    await user.click(screen.getByRole('button', { name: /Release escrow/ }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('falls back to generic copy for an unrecognised failure', async () => {
    setEvidence(READY);
    setPayments([makePayment()]);
    h.release.mutate.mockImplementationOnce((_vars, opts) => {
      opts?.onError?.('boom');
    });
    const user = userEvent.setup();
    renderPack();

    await user.click(screen.getByRole('button', { name: /Release escrow/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to release escrow');
  });

  it('names both requirements when a 409 carries no missing list', async () => {
    setEvidence(READY);
    setPayments([makePayment()]);
    h.release.mutate.mockImplementationOnce((_vars, opts) => {
      opts?.onError?.(new ApiError(409, JSON.stringify({ error: 'proof of work required' })));
    });
    const user = userEvent.setup();
    renderPack();

    await user.click(screen.getByRole('button', { name: /Release escrow/ }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Need check-in and an after photo before funds release',
    );
  });
});
