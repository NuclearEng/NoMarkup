// Behavior tests for the admin job reports queue.
import { render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminJobReport } from '@/hooks/useAdmin';

import { closest, installDialogStub } from './_admin-branch-helpers';
import { withQueryClient } from './_helpers';
import { describeReportPage } from './_report-page-suite';

vi.mock('@/components/ui/select', () => import('./_native-select-mock'));

const useAdminJobReportsMock = vi.fn();
const resolveMutateAsync = vi.fn();
const resolveState = { isPending: false };

vi.mock('@/hooks/useAdmin', () => ({
  useAdminJobReports: (...args: unknown[]) => useAdminJobReportsMock(...args) as unknown,
  useResolveJobReport: () => ({
    mutateAsync: resolveMutateAsync,
    isPending: resolveState.isPending,
  }),
}));

import AdminJobReportsPage from '@/app/(dashboard)/admin/job-reports/page';

function makeReport(overrides: Partial<AdminJobReport> = {}): AdminJobReport {
  return {
    id: 'r-1',
    job_id: 'jobid-abcdef-123456',
    job_title: 'Replace water heater',
    reporter_id: 'reporter-abcdef-123456',
    reporter_email: 'reporter@example.com',
    reason: 'scam',
    description: 'Asks for payment off-platform.',
    status: 'open',
    created_at: '2026-06-02T12:00:00Z',
    ...overrides,
  };
}

function renderWith(reports: AdminJobReport[]) {
  useAdminJobReportsMock.mockReturnValue({
    data: { reports, pagination: { page: 1, page_size: 20, total: reports.length } },
    isLoading: false,
    isError: false,
  });
  return render(withQueryClient(createElement(AdminJobReportsPage)));
}

beforeAll(() => {
  installDialogStub();
});

beforeEach(() => {
  vi.clearAllMocks();
  useAdminJobReportsMock.mockReset();
});

describeReportPage({
  title: 'Job Reports',
  Page: AdminJobReportsPage,
  listHook: useAdminJobReportsMock,
  resolveMutateAsync,
  resolveState,
  makeReport,
  knownReason: { value: 'harassment', label: 'Harassment' },
  actionedDescription: /Pair with a job suspend\/remove from \/admin\/jobs/,
  dismissDescription: /the job remains visible/,
});

describe('Job Reports — job and reporter cell', () => {
  it('shows the job title and the reporter email', () => {
    renderWith([makeReport()]);

    const row = closest(screen.getByText('Replace water heater'), 'tr');
    expect(within(row).getByText('Reporter: reporter@example.com')).toBeInTheDocument();
    expect(within(row).getByText('Scam')).toBeInTheDocument();
  });

  it('falls back to a short job id when the job has no title', () => {
    renderWith([makeReport({ job_title: '' })]);

    expect(screen.getByText('jobid-ab')).toBeInTheDocument();
  });

  it('falls back to a short reporter id when the reporter has no email', () => {
    renderWith([makeReport({ reporter_email: null })]);

    expect(screen.getByText('Reporter: reporter')).toBeInTheDocument();
  });

  it.each([
    ['null', null],
    ['omitted', undefined],
  ])('shows an anonymous reporter when the reporter id is %s', (_label, reporterId) => {
    renderWith([makeReport({ reporter_email: undefined, reporter_id: reporterId })]);

    expect(screen.getByText('Reporter: anonymous')).toBeInTheDocument();
  });
});
