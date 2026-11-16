// /insurance — the customer's policy list. Covers loading, error, empty
// (undefined and []) and populated states plus the status label/class mapping,
// including statuses outside the typed union (pending_payment, unknown slugs).
import { render, screen, within } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

interface PolicyRow {
  id: string;
  policy_number: string;
  coverage_amount_cents: number;
  premium_cents: number;
  status: string;
}

const policiesState: {
  data: { policies: PolicyRow[] } | undefined;
  isLoading: boolean;
  isError: boolean;
} = { data: undefined, isLoading: false, isError: false };

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/components/ui/animated-illustration', () => ({
  AnimatedIllustration: ({ type }: { type: string }) =>
    createElement('span', { 'data-testid': `illustration-${type}` }),
}));

vi.mock('@/hooks/useInsurance', () => ({
  useMyPolicies: () => policiesState,
}));

import InsurancePoliciesPage from '@/app/(dashboard)/insurance/page';

function renderPage() {
  return render(withQueryClient(createElement(InsurancePoliciesPage)));
}

function policy(status: string, overrides: Partial<PolicyRow> = {}): PolicyRow {
  return {
    id: `pol-${status}`,
    policy_number: `NM-${status}`,
    coverage_amount_cents: 2500000,
    premium_cents: 4999,
    status,
    ...overrides,
  };
}

function policyLink(policyNumber: string): HTMLElement {
  return screen.getByRole('link', { name: new RegExp(policyNumber) });
}

beforeEach(() => {
  vi.clearAllMocks();
  policiesState.data = undefined;
  policiesState.isLoading = false;
  policiesState.isError = false;
});

describe('InsurancePoliciesPage', () => {
  it('always links back to contracts', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Back to Contracts' })).toHaveAttribute(
      'href',
      '/contracts',
    );
  });

  it('shows no empty or error state while loading', () => {
    policiesState.isLoading = true;
    policiesState.isError = true;
    renderPage();

    expect(screen.queryByText('Failed to load policies')).toBeNull();
    expect(screen.queryByText('No insurance policies yet')).toBeNull();
    expect(screen.queryByTestId('illustration-error')).toBeNull();
  });

  it('shows the error state (not the empty state) when the query fails', () => {
    policiesState.isError = true;
    renderPage();

    expect(screen.getByText('Failed to load policies')).toBeInTheDocument();
    expect(screen.getByTestId('illustration-error')).toBeInTheDocument();
    expect(screen.queryByText('No insurance policies yet')).toBeNull();
  });

  it('shows the empty state when the query settled without data', () => {
    renderPage();

    expect(screen.getByText('No insurance policies yet')).toBeInTheDocument();
    expect(screen.getByTestId('illustration-no-contracts')).toBeInTheDocument();
  });

  it('shows the empty state for an empty policy list', () => {
    policiesState.data = { policies: [] };
    renderPage();

    expect(screen.getByText('No insurance policies yet')).toBeInTheDocument();
    expect(screen.queryByText('Failed to load policies')).toBeNull();
  });

  it('renders each policy as a link to its detail page with coverage and premium', () => {
    policiesState.data = {
      policies: [policy('active', { id: 'pol-1', policy_number: 'NM-0001' })],
    };
    renderPage();

    const link = policyLink('NM-0001');
    expect(link).toHaveAttribute('href', '/insurance/pol-1');
    expect(link).toHaveTextContent('Coverage $25,000.00 · Premium $49.99');
    expect(screen.queryByText('No insurance policies yet')).toBeNull();
  });

  it.each([
    ['active', 'Active', 'text-green-300'],
    ['pending_payment', 'Pending Payment', 'text-yellow-300'],
    ['expired', 'Expired', 'text-zinc-400'],
    ['cancelled', 'Cancelled', 'text-red-300'],
    ['claimed', 'Claimed', 'text-amber-300'],
  ])('maps the %s status to the "%s" badge with %s', (status, label, className) => {
    policiesState.data = { policies: [policy(status)] };
    renderPage();

    const badge = within(policyLink(`NM-${status}`)).getByText(label);
    expect(badge).toHaveClass(className);
  });

  it('humanises an unknown status and uses the neutral fallback class', () => {
    policiesState.data = { policies: [policy('under_review')] };
    renderPage();

    const badge = within(policyLink('NM-under_review')).getByText('Under Review');
    expect(badge).toHaveClass('text-zinc-400', 'border-zinc-500/30');
    expect(screen.queryByText('under_review')).toBeNull();
  });
});
