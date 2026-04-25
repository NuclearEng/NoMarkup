// Tests for the contract review submission page — exercises loading, error,
// already-reviewed, window-closed, not-eligible, and eligible (form-rendered) branches.
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const contractState: {
  data: { contract: Record<string, unknown> } | undefined;
  isLoading: boolean;
} = { data: undefined, isLoading: true };

const eligibilityState: {
  data:
    | {
        eligible: boolean;
        already_reviewed: boolean;
        review_window_closes_at: string;
      }
    | undefined;
  isLoading: boolean;
} = { data: undefined, isLoading: true };

const authUser: { user: { id: string } | null } = { user: { id: 'cust-1' } };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/contracts/abc/review',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({ id: 'contract-1' }),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/components/forms/ReviewForm', () => ({
  ReviewForm: ({ direction }: { direction: string }) =>
    createElement('div', { 'data-testid': 'review-form', 'data-direction': direction }, 'form'),
}));

vi.mock('@/hooks/useContracts', () => ({
  useContract: () => contractState,
}));

vi.mock('@/hooks/useReviews', () => ({
  useReviewEligibility: () => eligibilityState,
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector(authUser),
}));

const { default: ContractReviewPage } = await import(
  '@/app/(dashboard)/contracts/[id]/review/page'
);

function makeContract(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'contract-1',
    contract_number: 'CON-555',
    job_id: 'job-1',
    job_title: 'Job',
    customer_id: 'cust-1',
    provider_id: 'prov-1',
    bid_id: 'b-1',
    amount_cents: 1000,
    payment_timing: 'completion',
    status: 'completed',
    customer_accepted: true,
    provider_accepted: true,
    acceptance_deadline: '2026-04-30T00:00:00Z',
    milestones: [],
    created_at: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  contractState.data = undefined;
  contractState.isLoading = true;
  eligibilityState.data = undefined;
  eligibilityState.isLoading = true;
  authUser.user = { id: 'cust-1' };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ContractReviewPage', () => {
  it('renders without throwing in loading state', () => {
    const { container } = render(withQueryClient(createElement(ContractReviewPage)));
    expect(container).toBeTruthy();
  });

  it('renders error UI when contract data is missing', () => {
    contractState.isLoading = false;
    eligibilityState.isLoading = false;
    contractState.data = undefined;
    eligibilityState.data = undefined;
    render(withQueryClient(createElement(ContractReviewPage)));
    expect(screen.getByText(/Failed to load review information/i)).toBeDefined();
  });

  it('renders error UI when eligibility is missing', () => {
    contractState.isLoading = false;
    eligibilityState.isLoading = false;
    contractState.data = { contract: makeContract() };
    eligibilityState.data = undefined;
    render(withQueryClient(createElement(ContractReviewPage)));
    expect(screen.getByText(/Failed to load review information/i)).toBeDefined();
  });

  it('shows already-reviewed card when user has reviewed', () => {
    contractState.isLoading = false;
    eligibilityState.isLoading = false;
    contractState.data = { contract: makeContract() };
    eligibilityState.data = {
      eligible: false,
      already_reviewed: true,
      review_window_closes_at: '2026-05-01T00:00:00Z',
    };
    render(withQueryClient(createElement(ContractReviewPage)));
    expect(screen.getByText(/Already Reviewed/i)).toBeDefined();
  });

  it('shows review window closed card when window has passed', () => {
    contractState.isLoading = false;
    eligibilityState.isLoading = false;
    contractState.data = { contract: makeContract() };
    eligibilityState.data = {
      eligible: false,
      already_reviewed: false,
      review_window_closes_at: '2020-01-01T00:00:00Z',
    };
    render(withQueryClient(createElement(ContractReviewPage)));
    expect(screen.getByText(/Review Window Closed/i)).toBeDefined();
  });

  it('shows Not Eligible card for future window when ineligible', () => {
    contractState.isLoading = false;
    eligibilityState.isLoading = false;
    contractState.data = { contract: makeContract() };
    eligibilityState.data = {
      eligible: false,
      already_reviewed: false,
      review_window_closes_at: '2099-01-01T00:00:00Z',
    };
    render(withQueryClient(createElement(ContractReviewPage)));
    expect(screen.getByText(/You are not eligible to review/i)).toBeDefined();
  });

  it('renders review form for customer-to-provider direction', () => {
    contractState.isLoading = false;
    eligibilityState.isLoading = false;
    contractState.data = { contract: makeContract() };
    eligibilityState.data = {
      eligible: true,
      already_reviewed: false,
      review_window_closes_at: '2099-01-01T00:00:00Z',
    };
    render(withQueryClient(createElement(ContractReviewPage)));
    const form = screen.getByTestId('review-form');
    expect(form).toBeDefined();
    expect(form.getAttribute('data-direction')).toBe('customer_to_provider');
  });

  it('renders review form with provider-to-customer direction when user is provider', () => {
    authUser.user = { id: 'prov-1' };
    contractState.isLoading = false;
    eligibilityState.isLoading = false;
    contractState.data = { contract: makeContract() };
    eligibilityState.data = {
      eligible: true,
      already_reviewed: false,
      review_window_closes_at: '2099-01-01T00:00:00Z',
    };
    render(withQueryClient(createElement(ContractReviewPage)));
    const form = screen.getByTestId('review-form');
    expect(form.getAttribute('data-direction')).toBe('provider_to_customer');
  });

  it('shows the contract number in the heading when loaded', () => {
    contractState.isLoading = false;
    eligibilityState.isLoading = false;
    contractState.data = { contract: makeContract({ contract_number: 'CON-XYZ' }) };
    eligibilityState.data = {
      eligible: true,
      already_reviewed: false,
      review_window_closes_at: '2099-01-01T00:00:00Z',
    };
    render(withQueryClient(createElement(ContractReviewPage)));
    expect(screen.getByRole('heading', { name: /CON-XYZ/i })).toBeDefined();
  });
});
