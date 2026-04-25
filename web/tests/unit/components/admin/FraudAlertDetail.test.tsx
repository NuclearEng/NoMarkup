import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FraudAlertDetail } from '@/components/admin/FraudAlertDetail';
import type { FraudAlert, FraudSignal } from '@/types';

const mockReview = vi.fn().mockResolvedValue(undefined);

vi.mock('@/hooks/useFraud', () => ({
  useReviewFraudAlert: () => ({
    mutateAsync: mockReview,
    isPending: false,
    isError: false,
    isSuccess: false,
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
});
