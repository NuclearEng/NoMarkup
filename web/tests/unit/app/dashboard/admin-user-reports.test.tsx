// Behavior tests for the admin user (abuse) reports queue.
import { render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminUserReport } from '@/hooks/useAdmin';

import { closest, installDialogStub } from './_admin-branch-helpers';
import { withQueryClient } from './_helpers';
import { describeReportPage } from './_report-page-suite';

vi.mock('@/components/ui/select', () => import('./_native-select-mock'));

const useAdminUserReportsMock = vi.fn();
const resolveMutateAsync = vi.fn();
const resolveState = { isPending: false };

vi.mock('@/hooks/useAdmin', () => ({
  useAdminUserReports: (...args: unknown[]) => useAdminUserReportsMock(...args) as unknown,
  useResolveUserReport: () => ({
    mutateAsync: resolveMutateAsync,
    isPending: resolveState.isPending,
  }),
}));

import AdminUserReportsPage from '@/app/(dashboard)/admin/user-reports/page';

function makeReport(overrides: Partial<AdminUserReport> = {}): AdminUserReport {
  return {
    id: 'r-1',
    reporter_id: 'reporter-abcdef-123456',
    reporter_email: 'reporter@example.com',
    reported_user_id: 'offender-abcdef-123456',
    reported_user_email: 'offender@example.com',
    reason: 'inappropriate',
    description: 'Sent abusive messages.',
    status: 'open',
    created_at: '2026-06-02T12:00:00Z',
    ...overrides,
  };
}

function renderWith(reports: AdminUserReport[]) {
  useAdminUserReportsMock.mockReturnValue({
    data: { reports, pagination: { page: 1, page_size: 20, total: reports.length } },
    isLoading: false,
    isError: false,
  });
  return render(withQueryClient(createElement(AdminUserReportsPage)));
}

beforeAll(() => {
  installDialogStub();
});

beforeEach(() => {
  vi.clearAllMocks();
  useAdminUserReportsMock.mockReset();
});

describeReportPage({
  title: 'User Reports',
  Page: AdminUserReportsPage,
  listHook: useAdminUserReportsMock,
  resolveMutateAsync,
  resolveState,
  makeReport,
  knownReason: { value: 'harassment', label: 'Harassment' },
  actionedDescription: /Pair with a user suspend\/ban from \/admin\/users/,
  dismissDescription: /no action is taken against the user/,
});

describe('User Reports — reported user and reporter cell', () => {
  it('shows both emails and no chat marker for a profile report', () => {
    renderWith([makeReport()]);

    const row = closest(screen.getByText('offender@example.com'), 'tr');
    expect(within(row).getByText('By: reporter@example.com')).toBeInTheDocument();
    expect(within(row).queryByText(/from chat/)).not.toBeInTheDocument();
    expect(within(row).getByText('Inappropriate')).toBeInTheDocument();
  });

  it('marks reports that were filed from a chat channel', () => {
    renderWith([makeReport({ channel_id: 'chan-1' })]);

    expect(screen.getByText('By: reporter@example.com · from chat')).toBeInTheDocument();
  });

  it('falls back to short ids when neither party has an email', () => {
    renderWith([makeReport({ reported_user_email: null, reporter_email: undefined })]);

    expect(screen.getByText('offender')).toBeInTheDocument();
    expect(screen.getByText('By: reporter')).toBeInTheDocument();
  });
});
