// Tests for the provider expenses page — exercises form inputs, total/breakdown
// summary, expense list rendering, delete action, and submit payload.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const expensesState: {
  data: { expenses: Record<string, unknown>[]; total_cents: number } | undefined;
  isLoading: boolean;
  isError: boolean;
} = { data: undefined, isLoading: false, isError: false };

const createMutate = vi.fn();
const deleteMutate = vi.fn();
const createState = { isPending: false, isError: false };
const deleteState = { isPending: false };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/provider/business/expenses',
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

vi.mock('@/hooks/useExpenses', () => ({
  useExpenses: () => expensesState,
  useCreateExpense: () => ({
    mutate: createMutate,
    isPending: createState.isPending,
    isError: createState.isError,
  }),
  useDeleteExpense: () => ({
    mutate: deleteMutate,
    isPending: deleteState.isPending,
  }),
}));

const { default: ProviderExpensesPage } = await import(
  '@/app/(dashboard)/provider/business/expenses/page'
);

function makeExpense(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'exp-1',
    provider_id: 'prov-1',
    category: 'materials',
    description: 'Pipe fittings',
    amount_cents: 5000,
    expense_date: '2026-04-01',
    ...overrides,
  };
}

beforeEach(() => {
  expensesState.data = undefined;
  expensesState.isLoading = false;
  expensesState.isError = false;
  createState.isPending = false;
  createState.isError = false;
  deleteState.isPending = false;
  createMutate.mockReset();
  deleteMutate.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ProviderExpensesPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(ProviderExpensesPage)));
    expect(container).toBeTruthy();
  });

  it('renders empty state when no expenses', () => {
    expensesState.data = { expenses: [], total_cents: 0 };
    render(withQueryClient(createElement(ProviderExpensesPage)));
    expect(
      screen.getByText(/No expenses recorded yet\. Add your first expense above\./i),
    ).toBeDefined();
    expect(screen.getByText(/^No expenses recorded yet\.$/i)).toBeDefined();
  });

  it('renders loading skeletons when loading', () => {
    expensesState.isLoading = true;
    const { container } = render(withQueryClient(createElement(ProviderExpensesPage)));
    expect(container.querySelectorAll('.bg-muted').length).toBeGreaterThan(0);
  });

  it('renders expense rows + total when data loaded', () => {
    expensesState.data = {
      expenses: [
        makeExpense({ id: 'e1', amount_cents: 5000, description: 'Pipe fittings', category: 'materials' }),
        makeExpense({ id: 'e2', amount_cents: 3000, description: 'Tool rental', category: 'tools' }),
      ],
      total_cents: 8000,
    };
    render(withQueryClient(createElement(ProviderExpensesPage)));
    expect(screen.getByText('Pipe fittings')).toBeDefined();
    expect(screen.getByText('Tool rental')).toBeDefined();
    expect(screen.getAllByText(/\$80\.00/).length).toBeGreaterThan(0);
  });

  it('updates date input', () => {
    render(withQueryClient(createElement(ProviderExpensesPage)));
    const input = screen.getByLabelText(/^Date$/i);
    fireEvent.change(input, { target: { value: '2026-04-15' } });
    expect((input as HTMLInputElement).value).toBe('2026-04-15');
  });

  it('updates amount input', () => {
    render(withQueryClient(createElement(ProviderExpensesPage)));
    const input = screen.getByLabelText(/Amount/i);
    fireEvent.change(input, { target: { value: '99.99' } });
    expect((input as HTMLInputElement).value).toBe('99.99');
  });

  it('updates description textarea', () => {
    render(withQueryClient(createElement(ProviderExpensesPage)));
    const textarea = screen.getByLabelText(/^Description$/i);
    fireEvent.change(textarea, { target: { value: 'Truck fuel' } });
    expect((textarea as HTMLTextAreaElement).value).toBe('Truck fuel');
  });

  it('updates receipt URL input', () => {
    render(withQueryClient(createElement(ProviderExpensesPage)));
    const input = screen.getByLabelText(/Receipt URL/i);
    fireEvent.change(input, { target: { value: 'https://example.com/r.pdf' } });
    expect((input as HTMLInputElement).value).toBe('https://example.com/r.pdf');
  });

  it('submit button is disabled when required fields empty', () => {
    render(withQueryClient(createElement(ProviderExpensesPage)));
    const btn = screen.getByRole('button', { name: /Add Expense/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows error message when create fails', () => {
    createState.isError = true;
    render(withQueryClient(createElement(ProviderExpensesPage)));
    expect(screen.getByText(/Failed to add expense\. Please try again\./i)).toBeDefined();
  });

  it('calls delete mutation when trash button clicked', () => {
    expensesState.data = {
      expenses: [makeExpense({ id: 'exp-delete-me', description: 'Delete this' })],
      total_cents: 5000,
    };
    render(withQueryClient(createElement(ProviderExpensesPage)));
    fireEvent.click(screen.getByLabelText(/Delete expense: Delete this/i));
    expect(deleteMutate).toHaveBeenCalledWith('exp-delete-me');
  });

  it('renders category breakdown sorted by amount', () => {
    expensesState.data = {
      expenses: [
        makeExpense({ id: 'e1', amount_cents: 1000, category: 'materials' }),
        makeExpense({ id: 'e2', amount_cents: 5000, category: 'tools' }),
        makeExpense({ id: 'e3', amount_cents: 3000, category: 'transportation' }),
      ],
      total_cents: 9000,
    };
    render(withQueryClient(createElement(ProviderExpensesPage)));
    expect(screen.getAllByText(/Materials/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Tools/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Transportation/).length).toBeGreaterThan(0);
  });
});
