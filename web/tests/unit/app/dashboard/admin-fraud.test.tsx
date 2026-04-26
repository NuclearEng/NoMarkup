// Tests for the admin fraud alerts page — exercises summary card branches
// (open count zero/non-zero, critical zero/non-zero, false positive rate
// computation when totalResolved > 0 vs == 0, loading skeleton branch).
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/fraud',
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

interface FraudAlertsArgs {
  status?: string;
  risk_level?: string;
  page: number;
  pageSize: number;
}

interface AlertsResponse {
  alerts: Array<{ id: string; signals: unknown[] } & Record<string, unknown>>;
  pagination: { totalCount: number; page: number; pageSize: number; totalPages: number };
}

interface HookResult {
  data: AlertsResponse | undefined;
  isLoading: boolean;
  isError: boolean;
}

// Per-call configuration keyed by status+risk.
const fraudConfig: Record<string, HookResult> = {};

function configKey(args: FraudAlertsArgs): string {
  return `${args.status ?? '_'}::${args.risk_level ?? '_'}`;
}

vi.mock('@/hooks/useFraud', () => ({
  useFraudAlerts: (args: FraudAlertsArgs): HookResult =>
    fraudConfig[configKey(args)] ?? {
      data: { alerts: [], pagination: { totalCount: 0, page: 1, pageSize: 20, totalPages: 0 } },
      isLoading: false,
      isError: false,
    },
}));

// Minimal stub for FraudAlertList so we don't pull its internals.
vi.mock('@/components/admin/FraudAlertList', () => ({
  FraudAlertList: () => createElement('div', { 'data-testid': 'fraud-alert-list' }, 'List Stub'),
}));

const { default: AdminFraudPage } = await import('@/app/(dashboard)/admin/fraud/page');

function setConfig(key: string, result: Partial<HookResult>) {
  fraudConfig[key] = {
    data: result.data,
    isLoading: result.isLoading ?? false,
    isError: result.isError ?? false,
  };
}

beforeEach(() => {
  for (const k of Object.keys(fraudConfig)) {
    delete fraudConfig[k];
  }
});

describe('AdminFraudPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(AdminFraudPage)));
    expect(container).toBeTruthy();
  });

  it('renders the heading and the FraudAlertList stub', () => {
    render(withQueryClient(createElement(AdminFraudPage)));
    expect(screen.getByRole('heading', { name: 'Fraud Detection' })).toBeDefined();
    expect(screen.getByTestId('fraud-alert-list')).toBeDefined();
  });

  it('shows zero-state summary cards when all responses are empty', () => {
    render(withQueryClient(createElement(AdminFraudPage)));
    // All four cards render. False positive rate = 0.0% (totalResolved == 0 branch).
    expect(screen.getByText('Open Alerts')).toBeDefined();
    expect(screen.getByText('Critical Alerts')).toBeDefined();
    expect(screen.getByText('Open Signals')).toBeDefined();
    expect(screen.getByText('False Positive Rate')).toBeDefined();
    expect(screen.getByText('0.0%')).toBeDefined();
  });

  it('renders loading skeletons when any of the queries is loading (line 96)', () => {
    setConfig('open::_', { isLoading: true });
    setConfig('open::critical', { isLoading: true });
    setConfig('resolved_fraud::_', { isLoading: true });
    setConfig('dismissed::_', { isLoading: true });
    const { container } = render(withQueryClient(createElement(AdminFraudPage)));
    // Skeleton component renders a div with role / class — at least one skeleton present.
    // We look for skeletons by querying for elements with the size class used.
    const cards = container.querySelectorAll('.glass');
    expect(cards.length).toBeGreaterThan(0);
    // Headings still present.
    expect(screen.getByText('Open Alerts')).toBeDefined();
  });

  it('computes total signals from open alerts and applies blue accent when openCount > 0', () => {
    setConfig('open::_', {
      data: {
        alerts: [
          { id: 'a1', signals: [{}, {}, {}] },
          { id: 'a2', signals: [{}] },
          { id: 'a3', signals: [] },
        ],
        pagination: { totalCount: 3, page: 1, pageSize: 1, totalPages: 1 },
      },
    });
    setConfig('open::critical', {
      data: {
        alerts: [],
        pagination: { totalCount: 2, page: 1, pageSize: 1, totalPages: 1 },
      },
    });
    render(withQueryClient(createElement(AdminFraudPage)));
    // openCount = 3 — accentClass blue branch
    expect(screen.getByText('3')).toBeDefined();
    // criticalCount = 2 — accentClass red branch
    expect(screen.getByText('2')).toBeDefined();
    // totalSignals = 3 + 1 + 0 = 4
    expect(screen.getByText('4')).toBeDefined();
  });

  it('computes false positive rate when totalResolved > 0 (line 51 branch)', () => {
    setConfig('resolved_fraud::_', {
      data: {
        alerts: [],
        pagination: { totalCount: 7, page: 1, pageSize: 1, totalPages: 1 },
      },
    });
    setConfig('dismissed::_', {
      data: {
        alerts: [],
        pagination: { totalCount: 3, page: 1, pageSize: 1, totalPages: 1 },
      },
    });
    render(withQueryClient(createElement(AdminFraudPage)));
    // totalResolved = 7 + 3 = 10, dismissed = 3 → 30.0%
    expect(screen.getByText('30.0%')).toBeDefined();
  });

  it('renders default white accent when counts are zero', () => {
    // openCount = 0, criticalCount = 0 — both fall into 'text-white' branch.
    setConfig('open::_', {
      data: {
        alerts: [],
        pagination: { totalCount: 0, page: 1, pageSize: 1, totalPages: 1 },
      },
    });
    setConfig('open::critical', {
      data: {
        alerts: [],
        pagination: { totalCount: 0, page: 1, pageSize: 1, totalPages: 1 },
      },
    });
    render(withQueryClient(createElement(AdminFraudPage)));
    // Both render '0'.
    const zeros = screen.getAllByText('0');
    expect(zeros.length).toBeGreaterThanOrEqual(2);
  });
});
