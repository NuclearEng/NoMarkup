// Behavior tests for the admin goods (listing) reports queue.
import { render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminReport } from '@/hooks/useAdmin';

import { closest, installDialogStub } from './_admin-branch-helpers';
import { withQueryClient } from './_helpers';
import { describeReportPage } from './_report-page-suite';

vi.mock('@/components/ui/select', () => import('./_native-select-mock'));

const useAdminReportsMock = vi.fn();
const resolveMutateAsync = vi.fn();
const resolveState = { isPending: false };

vi.mock('@/hooks/useAdmin', () => ({
  useAdminReports: (...args: unknown[]) => useAdminReportsMock(...args) as unknown,
  useResolveReport: () => ({
    mutateAsync: resolveMutateAsync,
    isPending: resolveState.isPending,
  }),
}));

import AdminGoodsReportsPage from '@/app/(dashboard)/admin/goods-reports/page';

function makeReport(overrides: Partial<AdminReport> = {}): AdminReport {
  return {
    id: 'r-1',
    listing_id: 'listing-abcdef-123456',
    listing_title: 'Vintage Drill Press',
    reporter_id: 'reporter-abcdef-123456',
    reporter_email: 'reporter@example.com',
    reason: 'stolen',
    description: 'Serial number matches a police report.',
    status: 'open',
    created_at: '2026-06-02T12:00:00Z',
    ...overrides,
  };
}

function renderWith(reports: AdminReport[]) {
  useAdminReportsMock.mockReturnValue({
    data: { reports, pagination: { page: 1, page_size: 20, total: reports.length } },
    isLoading: false,
    isError: false,
  });
  return render(withQueryClient(createElement(AdminGoodsReportsPage)));
}

beforeAll(() => {
  installDialogStub();
});

beforeEach(() => {
  vi.clearAllMocks();
  useAdminReportsMock.mockReset();
});

describeReportPage({
  title: 'Goods Reports',
  Page: AdminGoodsReportsPage,
  listHook: useAdminReportsMock,
  resolveMutateAsync,
  resolveState,
  makeReport,
  knownReason: { value: 'counterfeit', label: 'Counterfeit' },
  actionedDescription: /Pair with a listing suspend\/cancel from \/admin\/listings/,
  dismissDescription: /the listing remains visible/,
});

describe('Goods Reports — listing and reporter cell', () => {
  it('shows the listing title and the reporter email', () => {
    renderWith([makeReport()]);

    const row = closest(screen.getByText('Vintage Drill Press'), 'tr');
    expect(within(row).getByText('Reporter: reporter@example.com')).toBeInTheDocument();
    expect(within(row).getByText('Stolen')).toBeInTheDocument();
  });

  it('falls back to a short listing id when the listing has no title', () => {
    renderWith([makeReport({ listing_title: '' })]);

    expect(screen.getByText('listing-')).toBeInTheDocument();
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
