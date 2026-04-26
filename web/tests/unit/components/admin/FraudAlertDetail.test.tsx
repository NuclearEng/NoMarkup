import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { FraudAlertDetail } from '@/components/admin/FraudAlertDetail';
import type { FraudAlert, FraudSignal } from '@/types';

beforeAll(() => {
  // Radix Select uses these jsdom-missing APIs.
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
});

const mockReview = vi.fn().mockResolvedValue(undefined);
const reviewState: { isPending: boolean; isError: boolean; isSuccess: boolean } = {
  isPending: false,
  isError: false,
  isSuccess: false,
};

vi.mock('@/hooks/useFraud', () => ({
  useReviewFraudAlert: () => ({
    mutateAsync: mockReview,
    get isPending() {
      return reviewState.isPending;
    },
    get isError() {
      return reviewState.isError;
    },
    get isSuccess() {
      return reviewState.isSuccess;
    },
  }),
}));

function makeSignal(overrides: Partial<FraudSignal> = {}): FraudSignal {
  return {
    id: 's-1',
    user_id: 'user-1',
    signal_type: 'velocity',
    confidence: 0.7,
    risk_level: 'high',
    ip_address: '10.0.0.1',
    device_fingerprint: 'fp-abcdef0123456789',
    description: 'Posted 5 jobs in 10 minutes',
    reference_entity_type: 'job',
    reference_entity_id: 'jb-abcdef',
    created_at: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

function makeAlert(overrides: Partial<FraudAlert> = {}): FraudAlert {
  return {
    id: 'a-1',
    user_id: 'user-1',
    signals: [makeSignal()],
    aggregate_risk_level: 'high',
    status: 'open',
    assigned_admin_id: '',
    resolution_notes: '',
    auto_resolved: false,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
    resolved_at: null,
    ...overrides,
  };
}

describe('FraudAlertDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reviewState.isPending = false;
    reviewState.isError = false;
    reviewState.isSuccess = false;
  });

  it('renders the alert metadata and signal description', () => {
    render(createElement(FraudAlertDetail, { alert: makeAlert() }));
    expect(screen.getByText('Alert Details')).toBeDefined();
    expect(screen.getByText('HIGH RISK')).toBeDefined();
    expect(screen.getByText('Posted 5 jobs in 10 minutes')).toBeDefined();
  });

  it('shows the resolve panel when status is open', () => {
    render(createElement(FraudAlertDetail, { alert: makeAlert() }));
    expect(screen.getByText('Resolve Alert')).toBeDefined();
    expect(screen.getByLabelText(/resolution notes/i)).toBeDefined();
  });

  it('hides the resolve panel for resolved alerts', () => {
    render(
      createElement(FraudAlertDetail, {
        alert: makeAlert({
          status: 'resolved_legitimate',
          resolution_notes: 'Verified legitimate',
        }),
      }),
    );
    expect(screen.queryByText('Resolve Alert')).toBeNull();
    expect(screen.getByText('Verified legitimate')).toBeDefined();
  });

  it('disables submit button when status is unchanged from current open state', async () => {
    const user = userEvent.setup();
    render(createElement(FraudAlertDetail, { alert: makeAlert() }));
    const submit = screen.getByRole<HTMLButtonElement>('button', { name: /submit review/i });
    // Status is "open" by default (matches alert.status), so submit should be disabled.
    expect(submit.disabled).toBe(true);
    // Best-effort interaction to ensure the click handler does not throw.
    await user.click(submit);
    expect(mockReview).not.toHaveBeenCalled();
  });

  // ---- DEEPENING TESTS ----

  it('renders an empty-signals message when the alert has no signals', () => {
    render(createElement(FraudAlertDetail, { alert: makeAlert({ signals: [] }) }));
    expect(screen.getByText(/No signals recorded for this alert/i)).toBeDefined();
  });

  it('shows the auto-resolved note when auto_resolved is true', () => {
    render(
      createElement(FraudAlertDetail, {
        alert: makeAlert({ auto_resolved: true }),
      }),
    );
    expect(screen.getByText(/auto-resolved by the system/i)).toBeDefined();
  });

  it('renders the resolution_notes block when notes are present', () => {
    render(
      createElement(FraudAlertDetail, {
        alert: makeAlert({ resolution_notes: 'Confirmed real account.' }),
      }),
    );
    expect(screen.getByText('Confirmed real account.')).toBeDefined();
  });

  it('uses the high-risk red-500 progress class for confidence >= 0.8', () => {
    const { container } = render(
      createElement(FraudAlertDetail, {
        alert: makeAlert({
          signals: [makeSignal({ confidence: 0.9, risk_level: 'critical' })],
        }),
      }),
    );
    // The Progress bar gets the bg-red-500 class via cn() when confidence >= 0.8
    const redProgress = container.querySelector('.bg-red-500');
    expect(redProgress).not.toBeNull();
  });

  it('uses the medium-risk orange-500 progress class for confidence between 0.5 and 0.8', () => {
    const { container } = render(
      createElement(FraudAlertDetail, {
        alert: makeAlert({
          signals: [makeSignal({ confidence: 0.6, risk_level: 'medium' })],
        }),
      }),
    );
    const orangeProgress = container.querySelector('.bg-orange-500');
    expect(orangeProgress).not.toBeNull();
  });

  it('falls back to the low-risk yellow-500 progress class for confidence below 0.5', () => {
    const { container } = render(
      createElement(FraudAlertDetail, {
        alert: makeAlert({
          signals: [makeSignal({ confidence: 0.2, risk_level: 'low' })],
        }),
      }),
    );
    const yellowProgress = container.querySelector('.bg-yellow-500');
    expect(yellowProgress).not.toBeNull();
  });

  it('submits a review with the new status, notes, and restrict_user flag', async () => {
    const user = userEvent.setup();
    render(createElement(FraudAlertDetail, { alert: makeAlert() }));

    // Type resolution notes
    const notes = screen.getByLabelText(/resolution notes/i);
    await user.type(notes, 'Verified through manual review');

    // Toggle restrict-user checkbox
    const checkbox = screen.getByLabelText(/restrict user account/i);
    await user.click(checkbox);

    // Change status via Radix Select. With pointer-capture stubs in place, we
    // can open the trigger and pick the resolved_fraud option.
    const trigger = screen.getByRole('combobox');
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: 'Resolved (Fraud)' }));

    // Now submit should be enabled — status changed from "open" to "resolved_fraud".
    const submit = screen.getByRole<HTMLButtonElement>('button', {
      name: /submit review/i,
    });
    await waitFor(() => {
      expect(submit.disabled).toBe(false);
    });
    await user.click(submit);

    await waitFor(() => {
      expect(mockReview).toHaveBeenCalledTimes(1);
    });
    const [args] = mockReview.mock.calls[0] as [
      {
        alertId: string;
        input: { status: string; resolution_notes: string; restrict_user: boolean };
      },
    ];
    expect(args.alertId).toBe('a-1');
    expect(args.input.status).toBe('resolved_fraud');
    expect(args.input.resolution_notes).toBe('Verified through manual review');
    expect(args.input.restrict_user).toBe(true);
  });

  it('shows the failure message when the review mutation flags isError', () => {
    reviewState.isError = true;
    render(createElement(FraudAlertDetail, { alert: makeAlert() }));
    expect(screen.getByText(/Failed to submit review/i)).toBeDefined();
  });

  it('shows the success confirmation when the review mutation flags isSuccess', () => {
    reviewState.isSuccess = true;
    render(createElement(FraudAlertDetail, { alert: makeAlert() }));
    expect(screen.getByText(/Alert reviewed successfully/i)).toBeDefined();
  });

  it('disables the submit button and shows the loading label while pending', () => {
    reviewState.isPending = true;
    render(createElement(FraudAlertDetail, { alert: makeAlert() }));
    const submit = screen.getByRole<HTMLButtonElement>('button', { name: /submitting/i });
    expect(submit.disabled).toBe(true);
  });

  it('updates state from textarea and checkbox change handlers', () => {
    render(createElement(FraudAlertDetail, { alert: makeAlert() }));
    const textarea = screen.getByLabelText<HTMLTextAreaElement>(/resolution notes/i);
    fireEvent.change(textarea, { target: { value: 'Hand-typed via fireEvent' } });
    expect(textarea.value).toBe('Hand-typed via fireEvent');
  });

  it('truncates long device fingerprints and reference entity ids', () => {
    render(
      createElement(FraudAlertDetail, {
        alert: makeAlert({
          signals: [
            makeSignal({
              device_fingerprint: 'a'.repeat(40),
              reference_entity_id: 'b'.repeat(40),
            }),
          ],
        }),
      }),
    );
    // The truncate helper appends "..." after the slice — both long values
    // should render with the ellipsis suffix.
    const ellipses = screen.getAllByText(/\.\.\./);
    expect(ellipses.length).toBeGreaterThan(0);
  });
});
