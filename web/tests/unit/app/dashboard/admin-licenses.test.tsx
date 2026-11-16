// Behavior tests for the admin professional-licenses review page: the status
// tabs drive the query, pending rows can be verified / rejected, and reviewed
// rows show their outcome instead of actions.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminLicense } from '@/hooks/useProviderLicenses';

import { closest } from './_admin-branch-helpers';
import { withQueryClient } from './_helpers';

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

const useAdminLicensesMock = vi.fn();
const reviewMutate = vi.fn();
const reviewState = { isPending: false };
const refetch = vi.fn();

vi.mock('@/hooks/useProviderLicenses', async () => {
  // Keep the real const-object enums so labels and filter values are real.
  const actual = await vi.importActual<typeof import('@/hooks/useProviderLicenses')>(
    '@/hooks/useProviderLicenses',
  );
  return {
    ...actual,
    useAdminLicenses: (...args: unknown[]) => useAdminLicensesMock(...args) as unknown,
    useReviewLicense: () => ({ mutate: reviewMutate, isPending: reviewState.isPending }),
  };
});

import AdminLicensesPage from '@/app/(dashboard)/admin/licenses/page';

function makeLicense(overrides: Partial<AdminLicense> = {}): AdminLicense {
  return {
    id: 'lic-1',
    provider_id: 'prov-1',
    license_type: 'bar',
    license_number: 'CA-123456',
    jurisdiction: 'California',
    status: 'pending',
    created_at: '2026-05-10T12:00:00Z',
    updated_at: '2026-05-10T12:00:00Z',
    ...overrides,
  };
}

function loaded(licenses: AdminLicense[]) {
  useAdminLicensesMock.mockReturnValue({
    data: { licenses },
    isLoading: false,
    isError: false,
    refetch,
  });
}

function renderPage() {
  return render(withQueryClient(createElement(AdminLicensesPage)));
}

function row(licenseNumber: string): HTMLElement {
  return closest(screen.getByText(licenseNumber), 'tr');
}

beforeEach(() => {
  vi.clearAllMocks();
  useAdminLicensesMock.mockReset();
  reviewState.isPending = false;
});

describe('AdminLicensesPage — load states', () => {
  it('shows neither rows nor the empty state while loading', () => {
    useAdminLicensesMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch,
    });
    renderPage();

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('No licenses to review')).not.toBeInTheDocument();
    expect(screen.queryByText('Failed to load licenses')).not.toBeInTheDocument();
  });

  it('offers a retry that refetches when the query fails', async () => {
    const user = userEvent.setup();
    useAdminLicensesMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });
    renderPage();

    expect(screen.getByText('Failed to load licenses')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state when no license matches the filter', () => {
    loaded([]);
    renderPage();

    expect(screen.getByText('No licenses to review')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('treats a response with no licenses array as empty', () => {
    useAdminLicensesMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      refetch,
    });
    renderPage();

    expect(screen.getByText('No licenses to review')).toBeInTheDocument();
  });
});

describe('AdminLicensesPage — filter tabs', () => {
  it('starts on the pending queue', () => {
    loaded([]);
    renderPage();

    expect(useAdminLicensesMock).toHaveBeenLastCalledWith('pending');
    expect(screen.getByRole('tab', { name: 'Pending' })).toHaveAttribute('aria-selected', 'true');
  });

  it.each([
    ['Verified', 'verified'],
    ['Rejected', 'rejected'],
    ['All', 'all'],
  ])('re-queries with the %s filter when its tab is chosen', async (label, filter) => {
    const user = userEvent.setup();
    loaded([]);
    renderPage();

    await user.click(screen.getByRole('tab', { name: label }));

    expect(useAdminLicensesMock).toHaveBeenLastCalledWith(filter);
    expect(screen.getByRole('tab', { name: label })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Pending' })).toHaveAttribute('aria-selected', 'false');
  });
});

describe('AdminLicensesPage — rows', () => {
  it('renders a pending license with a link to the provider and review actions', () => {
    loaded([makeLicense()]);
    renderPage();

    const r = row('CA-123456');
    expect(within(r).getByRole('link', { name: 'prov-1' })).toHaveAttribute(
      'href',
      '/admin/users/prov-1',
    );
    expect(within(r).getByText('Bar license')).toBeInTheDocument();
    expect(within(r).getByText('California')).toBeInTheDocument();
    expect(within(r).getByText('May 10, 2026')).toBeInTheDocument();
    expect(within(r).getByRole('button', { name: /^Verify bar license/ })).toBeEnabled();
    expect(within(r).getByRole('button', { name: /^Reject bar license/ })).toBeEnabled();
  });

  it('verifies a pending license', async () => {
    const user = userEvent.setup();
    loaded([makeLicense({ id: 'lic-9' })]);
    renderPage();

    await user.click(
      screen.getByRole('button', { name: 'Verify bar license for provider prov-1' }),
    );

    expect(reviewMutate).toHaveBeenCalledExactlyOnceWith({ id: 'lic-9', status: 'verified' });
  });

  it('rejects a pending license', async () => {
    const user = userEvent.setup();
    loaded([makeLicense({ id: 'lic-9' })]);
    renderPage();

    await user.click(
      screen.getByRole('button', { name: 'Reject bar license for provider prov-1' }),
    );

    expect(reviewMutate).toHaveBeenCalledExactlyOnceWith({ id: 'lic-9', status: 'rejected' });
  });

  it('disables both review actions while a review is in flight', () => {
    reviewState.isPending = true;
    loaded([makeLicense()]);
    renderPage();

    expect(screen.getByRole('button', { name: /^Verify bar license/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Reject bar license/ })).toBeDisabled();
  });

  it('shows the outcome and review date instead of actions for a verified license', () => {
    loaded([makeLicense({ status: 'verified', verified_at: '2026-05-12T12:00:00Z' })]);
    renderPage();

    const r = row('CA-123456');
    expect(within(r).getByText('Verified')).toBeInTheDocument();
    expect(within(r).getByText('May 12, 2026')).toBeInTheDocument();
    expect(within(r).queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows a rejected license without a review date when none was recorded', () => {
    loaded([makeLicense({ status: 'rejected', verified_at: null })]);
    renderPage();

    const r = row('CA-123456');
    expect(within(r).getByText('Rejected')).toBeInTheDocument();
    expect(within(r).queryByRole('button')).not.toBeInTheDocument();
    // Only the submitted date is shown — no second (review) date.
    expect(within(r).getAllByText(/, \d{4}$/)).toHaveLength(1);
  });

  it('shows a dash when the submitted date is missing', () => {
    loaded([makeLicense({ created_at: '' })]);
    renderPage();

    expect(within(row('CA-123456')).getByText('—')).toBeInTheDocument();
  });
});
