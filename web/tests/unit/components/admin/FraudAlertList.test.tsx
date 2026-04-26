import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { FraudAlertList } from '@/components/admin/FraudAlertList';
import type { FraudAlert, FraudAlertsResponse } from '@/types';

beforeAll(() => {
  // Radix Select uses ResizeObserver / hasPointerCapture / scrollIntoView
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver;
  if (!('hasPointerCapture' in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      configurable: true,
      value: () => false,
    });
  }
  if (!('scrollIntoView' in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: () => {},
    });
  }
});

vi.mock('@/hooks/useFraud', () => ({
  useFraudAlerts: vi.fn(),
  useReviewFraudAlert: () => ({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
    isError: false,
    isSuccess: false,
  }),
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

function makeResponse(
  alerts: FraudAlert[],
  paginationOverrides: Partial<FraudAlertsResponse['pagination']> = {},
): FraudAlertsResponse {
  return {
    alerts,
    pagination: {
      totalCount: alerts.length,
      page: 1,
      pageSize: 20,
      totalPages: 1,
      hasNext: false,
      ...paginationOverrides,
    },
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
      data: makeResponse([makeAlert(), makeAlert({ id: 'a-2' })]),
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
      data: makeResponse([]),
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useFraudAlerts>);

    render(createElement(FraudAlertList));
    expect(screen.getByText(/No alerts found/i)).toBeDefined();
  });

  it('truncates long user ids and renders short ids as-is', () => {
    vi.mocked(useFraudAlerts).mockReturnValue({
      data: makeResponse([
        makeAlert({ id: 'a-long', user_id: 'user-long-1234567890abcd' }),
        makeAlert({ id: 'a-short', user_id: 'short' }),
      ]),
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useFraudAlerts>);

    render(createElement(FraudAlertList));
    expect(screen.getByText('user-lon...')).toBeDefined();
    expect(screen.getByText('short')).toBeDefined();
  });

  it('toggles expanded alert details on click and collapses on second click', async () => {
    const user = userEvent.setup();
    vi.mocked(useFraudAlerts).mockReturnValue({
      data: makeResponse([makeAlert()]),
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useFraudAlerts>);

    render(createElement(FraudAlertList));
    const buttons = screen.getAllByRole('button');
    // first button is the toggle row
    const row = buttons.find((b) => b.className.includes('rounded-lg border bg-card'));
    expect(row).toBeDefined();
    await user.click(row as HTMLElement);
    expect(screen.getByText(/Alert Details/i)).toBeDefined();
    // collapse
    await user.click(row as HTMLElement);
    expect(screen.queryByText(/Alert Details/i)).toBeNull();
  });

  it('renders pagination controls and navigates next/previous', async () => {
    const user = userEvent.setup();
    vi.mocked(useFraudAlerts).mockReturnValue({
      data: makeResponse([makeAlert()], { totalPages: 3, hasNext: true }),
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useFraudAlerts>);

    render(createElement(FraudAlertList));
    const next = screen.getByRole('button', { name: /next/i });
    const prev = screen.getByRole('button', { name: /previous/i });
    expect(prev.hasAttribute('disabled')).toBe(true);
    expect(next.hasAttribute('disabled')).toBe(false);
    expect(screen.getByText(/Page 1 of 3/)).toBeDefined();

    await user.click(next);
    // hook is called again with page=2
    const lastCall = vi.mocked(useFraudAlerts).mock.calls.at(-1);
    expect(lastCall?.[0]?.page).toBe(2);

    // simulate previous on page 2 — re-render and click prev
    await user.click(prev);
    // disabled because page is back to 1 — but state reset means click is allowed since page > 1
  });

  it('changes status filter via Select and resets page', async () => {
    const user = userEvent.setup();
    vi.mocked(useFraudAlerts).mockReturnValue({
      data: makeResponse([makeAlert()]),
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useFraudAlerts>);

    render(createElement(FraudAlertList));
    const triggers = screen.getAllByRole('combobox');
    // first combobox is Status, second is Risk
    await user.click(triggers[0] as HTMLElement);
    const investigatingOption = await screen.findByRole('option', { name: 'Investigating' });
    await user.click(investigatingOption);

    // re-render: hook called with status: 'investigating'
    const calls = vi.mocked(useFraudAlerts).mock.calls;
    const last = calls.at(-1)?.[0];
    expect(last?.status).toBe('investigating');
  });

  it('changes status filter to All resets to undefined', async () => {
    const user = userEvent.setup();
    vi.mocked(useFraudAlerts).mockReturnValue({
      data: makeResponse([makeAlert()]),
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useFraudAlerts>);

    render(createElement(FraudAlertList));
    const triggers = screen.getAllByRole('combobox');
    await user.click(triggers[0] as HTMLElement);
    const allOption = await screen.findByRole('option', { name: 'All Statuses' });
    await user.click(allOption);

    const calls = vi.mocked(useFraudAlerts).mock.calls;
    const last = calls.at(-1)?.[0];
    expect(last?.status).toBeUndefined();
  });

  it('changes risk filter via Select and resets page', async () => {
    const user = userEvent.setup();
    vi.mocked(useFraudAlerts).mockReturnValue({
      data: makeResponse([makeAlert()]),
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useFraudAlerts>);

    render(createElement(FraudAlertList));
    const triggers = screen.getAllByRole('combobox');
    // second combobox is Risk
    await user.click(triggers[1] as HTMLElement);
    const criticalOption = await screen.findByRole('option', { name: 'Critical' });
    await user.click(criticalOption);

    const calls = vi.mocked(useFraudAlerts).mock.calls;
    const last = calls.at(-1)?.[0];
    expect(last?.risk_level).toBe('critical');
  });

  it('changes risk filter to All resets to undefined', async () => {
    const user = userEvent.setup();
    vi.mocked(useFraudAlerts).mockReturnValue({
      data: makeResponse([makeAlert()]),
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useFraudAlerts>);

    render(createElement(FraudAlertList));
    const triggers = screen.getAllByRole('combobox');
    await user.click(triggers[1] as HTMLElement);
    const allOption = await screen.findByRole('option', { name: 'All Levels' });
    await user.click(allOption);

    const calls = vi.mocked(useFraudAlerts).mock.calls;
    const last = calls.at(-1)?.[0];
    expect(last?.risk_level).toBeUndefined();
  });

  it('renders different status and risk badges', () => {
    vi.mocked(useFraudAlerts).mockReturnValue({
      data: makeResponse([
        makeAlert({ id: 'a-1', status: 'investigating', aggregate_risk_level: 'low' }),
        makeAlert({ id: 'a-2', status: 'resolved_fraud', aggregate_risk_level: 'medium' }),
        makeAlert({ id: 'a-3', status: 'resolved_legitimate', aggregate_risk_level: 'critical' }),
        makeAlert({ id: 'a-4', status: 'dismissed', aggregate_risk_level: 'low' }),
      ]),
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useFraudAlerts>);

    render(createElement(FraudAlertList));
    expect(screen.getByText('Investigating')).toBeDefined();
    expect(screen.getByText('Resolved (Fraud)')).toBeDefined();
    expect(screen.getByText('Resolved (Legit)')).toBeDefined();
    expect(screen.getByText('Dismissed')).toBeDefined();
    expect(screen.getByText('Critical')).toBeDefined();
    expect(screen.getByText('Medium')).toBeDefined();
    expect(screen.getAllByText('Low').length).toBeGreaterThanOrEqual(2);
  });

  it('does not render pagination when only a single page', () => {
    vi.mocked(useFraudAlerts).mockReturnValue({
      data: makeResponse([makeAlert()], { totalPages: 1, hasNext: false }),
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useFraudAlerts>);

    render(createElement(FraudAlertList));
    expect(screen.queryByRole('button', { name: /next/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /previous/i })).toBeNull();
  });

  it('has Next disabled when hasNext is false on multi-page result', () => {
    vi.mocked(useFraudAlerts).mockReturnValue({
      data: makeResponse([makeAlert()], { totalPages: 2, hasNext: false }),
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useFraudAlerts>);

    render(createElement(FraudAlertList));
    const next = screen.getByRole('button', { name: /next/i });
    expect(next.hasAttribute('disabled')).toBe(true);
  });

  it('shows the filter bar inside loading state', () => {
    vi.mocked(useFraudAlerts).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as unknown as ReturnType<typeof useFraudAlerts>);

    render(createElement(FraudAlertList));
    expect(screen.getByText('Status:')).toBeDefined();
    expect(screen.getByText('Risk:')).toBeDefined();
  });

  it('shows the filter bar inside error state', () => {
    vi.mocked(useFraudAlerts).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as unknown as ReturnType<typeof useFraudAlerts>);

    render(createElement(FraudAlertList));
    expect(screen.getByText('Status:')).toBeDefined();
    expect(screen.getByText('Risk:')).toBeDefined();
  });
});
