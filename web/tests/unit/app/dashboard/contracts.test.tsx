// Tests for the Contracts list page — exercises tab content (loading, error,
// empty, data) and pagination handlers.
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const contractsState: {
  data: { contracts: { id: string }[]; pagination?: { totalPages: number; hasNext: boolean } } | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} = { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/contracts',
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

vi.mock('@/components/contracts/ContractCard', () => ({
  ContractCard: ({ contract }: { contract: { id: string } }) =>
    createElement('article', { 'data-testid': `contract-${contract.id}` }, contract.id),
}));

vi.mock('@/hooks/useContracts', () => ({
  useContracts: () => contractsState,
}));

import ContractsPage from '@/app/(dashboard)/contracts/page';

beforeEach(() => {
  contractsState.data = undefined;
  contractsState.isLoading = false;
  contractsState.isError = false;
  contractsState.refetch = vi.fn();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ContractsPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(ContractsPage)));
    expect(container).toBeTruthy();
  });

  it('renders the loading state without throwing', () => {
    contractsState.isLoading = true;
    const { container } = render(withQueryClient(createElement(ContractsPage)));
    expect(container).toBeTruthy();
  });

  it('renders the error state with Retry button', () => {
    contractsState.isError = true;
    render(withQueryClient(createElement(ContractsPage)));
    expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(0);
  });

  it('clicking Retry on the error state invokes refetch', () => {
    const refetch = vi.fn();
    contractsState.isError = true;
    contractsState.refetch = refetch;
    render(withQueryClient(createElement(ContractsPage)));
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0] as HTMLButtonElement);
    expect(refetch).toHaveBeenCalled();
  });

  it('renders the empty state with All-tab message', () => {
    contractsState.data = { contracts: [] };
    render(withQueryClient(createElement(ContractsPage)));
    expect(screen.getAllByText(/You have no contracts yet/i).length).toBeGreaterThan(0);
  });

  it('renders contract cards when data is present', () => {
    contractsState.data = { contracts: [{ id: 'c1' }, { id: 'c2' }] };
    render(withQueryClient(createElement(ContractsPage)));
    expect(screen.getAllByTestId('contract-c1').length).toBeGreaterThan(0);
  });

  it('renders 5 tabs: All, Pending, Active, Completed, Cancelled', () => {
    contractsState.data = { contracts: [] };
    render(withQueryClient(createElement(ContractsPage)));
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBe(5);
  });

  it('renders Previous/Next pagination when totalPages > 1', () => {
    contractsState.data = {
      contracts: [{ id: 'cx' }],
      pagination: { totalPages: 4, hasNext: true },
    };
    render(withQueryClient(createElement(ContractsPage)));
    const prev = screen.getAllByRole('button', { name: 'Previous' })[0] as HTMLButtonElement;
    const next = screen.getAllByRole('button', { name: 'Next' })[0] as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    fireEvent.click(next);
    expect(screen.getAllByText(/Page/i).length).toBeGreaterThan(0);
  });

  it('clicking Previous after Next decrements page', () => {
    contractsState.data = {
      contracts: [{ id: 'cx' }],
      pagination: { totalPages: 5, hasNext: true },
    };
    render(withQueryClient(createElement(ContractsPage)));
    const next = screen.getAllByRole('button', { name: 'Next' })[0] as HTMLButtonElement;
    fireEvent.click(next); // page=2
    fireEvent.click(next); // page=3
    const prev = screen.getAllByRole('button', { name: 'Previous' })[0] as HTMLButtonElement;
    expect(prev.disabled).toBe(false);
    fireEvent.click(prev); // back to page=2
    expect(screen.getAllByText(/Page 2 of 5/).length).toBeGreaterThan(0);
  });

  it('clicking each tab exercises the tabToStatusFilter switch cases', async () => {
    const user = userEvent.setup();
    contractsState.data = { contracts: [] };
    render(withQueryClient(createElement(ContractsPage)));
    await user.click(screen.getByRole('tab', { name: 'Pending' }));
    expect(screen.getAllByText(/No contracts pending acceptance/i).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('tab', { name: 'Active' }));
    expect(screen.getAllByText(/No active contracts/i).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('tab', { name: 'Completed' }));
    expect(screen.getAllByText(/No completed contracts/i).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('tab', { name: 'Cancelled' }));
    expect(screen.getAllByText(/No cancelled contracts/i).length).toBeGreaterThan(0);
  });
});
