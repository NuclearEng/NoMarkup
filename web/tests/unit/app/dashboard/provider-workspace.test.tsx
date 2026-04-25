// Tests for the provider workspace page — exercises loading skeletons,
// today vs upcoming buckets, empty states, and grouping by date.
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const contractsState: {
  data: { contracts: Record<string, unknown>[] } | undefined;
  isLoading: boolean;
  isError: boolean;
} = { data: undefined, isLoading: false, isError: false };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/provider/workspace',
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

vi.mock('@/components/providers/CheckInOut', () => ({
  CheckInOut: () => createElement('div', { 'data-testid': 'check-in-out' }),
}));

vi.mock('@/components/providers/CompletionPhotos', () => ({
  CompletionPhotos: () => createElement('div', { 'data-testid': 'completion-photos' }),
}));

vi.mock('@/hooks/useContracts', () => ({
  useContracts: () => contractsState,
}));

const { default: ProviderWorkspacePage } = await import(
  '@/app/(dashboard)/provider/workspace/page'
);

function makeContract(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'c-1',
    contract_number: 'CON-001',
    job_id: 'j-1',
    job_title: 'Fix Sink',
    customer_id: 'cust-1',
    provider_id: 'prov-1',
    bid_id: 'b-1',
    amount_cents: 25000,
    payment_timing: 'completion',
    status: 'active',
    customer_accepted: true,
    provider_accepted: true,
    acceptance_deadline: '2099-04-30T00:00:00Z',
    milestones: [],
    created_at: '2099-04-15T12:00:00Z',
    started_at: undefined,
    ...overrides,
  };
}

beforeEach(() => {
  contractsState.data = undefined;
  contractsState.isLoading = false;
  contractsState.isError = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ProviderWorkspacePage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(ProviderWorkspacePage)));
    expect(container).toBeTruthy();
  });

  it('renders Workspace heading', () => {
    render(withQueryClient(createElement(ProviderWorkspacePage)));
    expect(screen.getByRole('heading', { name: 'Workspace' })).toBeDefined();
  });

  it('shows skeletons when loading', () => {
    contractsState.isLoading = true;
    const { container } = render(withQueryClient(createElement(ProviderWorkspacePage)));
    // skeletons render as styled divs; just assert no real cards yet
    expect(container.querySelector('[data-testid="check-in-out"]')).toBeNull();
  });

  it('renders empty today + upcoming states when no active contracts', () => {
    contractsState.data = { contracts: [] };
    render(withQueryClient(createElement(ProviderWorkspacePage)));
    expect(screen.getByText(/No jobs scheduled for today/i)).toBeDefined();
    expect(screen.getByText(/No upcoming jobs in the next 7 days/i)).toBeDefined();
  });

  it('renders today section heading', () => {
    contractsState.data = { contracts: [] };
    render(withQueryClient(createElement(ProviderWorkspacePage)));
    expect(screen.getByRole('heading', { name: /Today/i })).toBeDefined();
  });

  it('renders today contract with check-in/photos when started_at is today', () => {
    const today = new Date().toISOString();
    contractsState.data = {
      contracts: [makeContract({ id: 'today-1', started_at: today, job_title: 'Today Job' })],
    };
    render(withQueryClient(createElement(ProviderWorkspacePage)));
    expect(screen.getByText('Today Job')).toBeDefined();
    expect(screen.getByTestId('check-in-out')).toBeDefined();
    expect(screen.getByTestId('completion-photos')).toBeDefined();
  });

  it('shows In Progress badge for contracts that have started_at today', () => {
    const today = new Date().toISOString();
    contractsState.data = {
      contracts: [makeContract({ id: 'today-1', started_at: today })],
    };
    render(withQueryClient(createElement(ProviderWorkspacePage)));
    expect(screen.getByText('In Progress')).toBeDefined();
  });

  it('renders upcoming contracts grouped by date', () => {
    // Use far-future date so it lands in upcoming, not today
    const future = '2099-04-20T00:00:00Z';
    contractsState.data = {
      contracts: [
        makeContract({
          id: 'upcoming-1',
          started_at: future,
          created_at: future,
          job_title: 'Future Job',
        }),
      ],
    };
    render(withQueryClient(createElement(ProviderWorkspacePage)));
    expect(screen.getByText('Future Job')).toBeDefined();
    // Upcoming jobs do NOT show check-in/photos
    expect(screen.queryByTestId('check-in-out')).toBeNull();
  });

  it('skips non-active contracts when filtering today', () => {
    const today = new Date().toISOString();
    contractsState.data = {
      contracts: [
        makeContract({ id: 'completed', status: 'completed', started_at: today, job_title: 'Done' }),
      ],
    };
    render(withQueryClient(createElement(ProviderWorkspacePage)));
    expect(screen.queryByText('Done')).toBeNull();
    expect(screen.getByText(/No jobs scheduled for today/i)).toBeDefined();
  });

  it('uses created_at for date when started_at is missing', () => {
    const today = new Date().toISOString();
    contractsState.data = {
      contracts: [
        makeContract({ id: 'no-start', created_at: today, started_at: undefined, job_title: 'NoStart' }),
      ],
    };
    render(withQueryClient(createElement(ProviderWorkspacePage)));
    expect(screen.getByText('NoStart')).toBeDefined();
  });
});
