import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FraudAlertList } from '@/components/admin/FraudAlertList';
import type { FraudAlert } from '@/types';

vi.mock('@/hooks/useFraud', () => ({
  useFraudAlerts: vi.fn(),
  useReviewFraudAlert: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: false }),
}));

const { useFraudAlerts } = await import('@/hooks/useFraud');

function makeAlert(overrides: Partial<FraudAlert> = {}): FraudAlert {
  return {
    id: 'a-1',
    user_id: 'user-12345678abcd',
    signals: [],
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

describe('FraudAlertList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state', () => {
    vi.mocked(useFraudAlerts).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as unknown as ReturnType<typeof useFraudAlerts>);

    const { container } = render(createElement(FraudAlertList));
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('renders error state', () => {
    vi.mocked(useFraudAlerts).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as unknown as ReturnType<typeof useFraudAlerts>);

    render(createElement(FraudAlertList));
    expect(screen.getByText(/Failed to load fraud alerts/i)).toBeDefined();
  });

  it('renders alerts list', () => {
    vi.mocked(useFraudAlerts).mockReturnValue({
      data: { alerts: [makeAlert(), makeAlert({ id: 'a-2' })] },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useFraudAlerts>);

    render(createElement(FraudAlertList));
    // Two High risk badges should render.
    const highBadges = screen.getAllByText('High');
    expect(highBadges.length).toBeGreaterThanOrEqual(2);
  });

  it('renders empty state when no alerts match filters', () => {
    vi.mocked(useFraudAlerts).mockReturnValue({
      data: { alerts: [] },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useFraudAlerts>);

    render(createElement(FraudAlertList));
    expect(screen.getByText(/No alerts found/i)).toBeDefined();
  });
});
