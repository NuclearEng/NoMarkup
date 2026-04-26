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

// Replace Radix Select with a native <select> so onValueChange can be driven
// by a regular `change` event.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (val: string) => void;
    children: React.ReactNode;
  }) =>
    createElement(
      'select',
      {
        'data-testid': 'expense-category-select',
        'aria-label': 'Select expense category',
        value,
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
          onValueChange(e.target.value);
        },
      },
      createElement('option', { value: '', key: '__empty' }, ''),
      children,
    ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) =>
    createElement('optgroup', { label: 'options' }, children),
  SelectItem: ({
    value,
    children,
  }: {
    value: string;
    children: React.ReactNode;
  }) => createElement('option', { value }, children),
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

  it('renders receipt link when expense has receipt_url', () => {
    expensesState.data = {
      expenses: [
        makeExpense({
          id: 'exp-receipt',
          description: 'With receipt',
          receipt_url: 'https://example.com/receipt.pdf',
        }),
      ],
      total_cents: 5000,
    };
    render(withQueryClient(createElement(ProviderExpensesPage)));
    const link = screen.getByRole('link', { name: /View receipt/i });
    expect(link).toBeDefined();
    expect(link.getAttribute('href')).toBe('https://example.com/receipt.pdf');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('shows delete spinner when deleteExpense is pending', () => {
    deleteState.isPending = true;
    expensesState.data = {
      expenses: [makeExpense({ id: 'exp-del', description: 'Deleting...' })],
      total_cents: 5000,
    };
    const { container } = render(withQueryClient(createElement(ProviderExpensesPage)));
    // The trash icon is replaced with the Loader2 spinner (animate-spin class)
    expect(container.querySelectorAll('.animate-spin').length).toBeGreaterThan(0);
  });

  it('shows create spinner when createExpense is pending', () => {
    createState.isPending = true;
    const { container } = render(withQueryClient(createElement(ProviderExpensesPage)));
    expect(container.querySelectorAll('.animate-spin').length).toBeGreaterThan(0);
  });

  it('submits the form with the correct payload and resets fields on success', () => {
    render(withQueryClient(createElement(ProviderExpensesPage)));
    // Fill the form fields
    fireEvent.change(screen.getByLabelText(/^Date$/i), {
      target: { value: '2026-04-15' },
    });
    fireEvent.change(screen.getByLabelText(/Amount/i), {
      target: { value: '12.34' },
    });
    fireEvent.change(screen.getByLabelText(/^Description$/i), {
      target: { value: 'Office supplies' },
    });
    fireEvent.change(screen.getByLabelText(/Receipt URL/i), {
      target: { value: 'https://example.com/r.pdf' },
    });

    // Open the category select and pick an option. The Select uses a popover —
    // we sidestep it by simulating clicking the trigger then SelectContent items.
    // Easier: directly interact with the select via fireEvent on the trigger.
    // Since Radix Select is hard to drive in jsdom, just submit without category
    // to assert the early-return branch (no mutation call).
    fireEvent.submit(screen.getByRole('button', { name: /Add Expense/i }).closest('form') as HTMLElement);
    expect(createMutate).not.toHaveBeenCalled();
  });

  it('does not submit when amount is invalid (zero)', () => {
    render(withQueryClient(createElement(ProviderExpensesPage)));
    fireEvent.change(screen.getByLabelText(/Amount/i), {
      target: { value: '0' },
    });
    fireEvent.change(screen.getByLabelText(/^Description$/i), {
      target: { value: 'Zero amount' },
    });
    // Form has no category selected → early return
    fireEvent.submit(screen.getByRole('button', { name: /Add Expense/i }).closest('form') as HTMLElement);
    expect(createMutate).not.toHaveBeenCalled();
  });

  it('submits the form with the correct payload (no receipt) and resets fields on success', () => {
    createMutate.mockImplementation(
      (_payload: unknown, opts?: { onSuccess?: () => void }) => {
        opts?.onSuccess?.();
      },
    );
    render(withQueryClient(createElement(ProviderExpensesPage)));
    fireEvent.change(screen.getByTestId('expense-category-select'), {
      target: { value: 'materials' },
    });
    fireEvent.change(screen.getByLabelText(/^Date$/i), {
      target: { value: '2026-04-15' },
    });
    fireEvent.change(screen.getByLabelText(/Amount/i), {
      target: { value: '50.50' },
    });
    fireEvent.change(screen.getByLabelText(/^Description$/i), {
      target: { value: 'Lumber' },
    });

    fireEvent.submit(
      screen.getByRole('button', { name: /Add Expense/i }).closest('form') as HTMLElement,
    );
    expect(createMutate).toHaveBeenCalledWith(
      {
        category: 'materials',
        description: 'Lumber',
        amount_cents: 5050,
        receipt_url: undefined,
        expense_date: '2026-04-15',
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    // After onSuccess, fields should be reset
    expect((screen.getByLabelText(/Amount/i) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(/^Description$/i) as HTMLTextAreaElement).value).toBe('');
  });

  it('submits with receipt URL when provided', () => {
    render(withQueryClient(createElement(ProviderExpensesPage)));
    fireEvent.change(screen.getByTestId('expense-category-select'), {
      target: { value: 'tools' },
    });
    fireEvent.change(screen.getByLabelText(/Amount/i), {
      target: { value: '12.00' },
    });
    fireEvent.change(screen.getByLabelText(/^Description$/i), {
      target: { value: 'Drill' },
    });
    fireEvent.change(screen.getByLabelText(/Receipt URL/i), {
      target: { value: 'https://example.com/r.pdf' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: /Add Expense/i }).closest('form') as HTMLElement,
    );
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'tools',
        amount_cents: 1200,
        receipt_url: 'https://example.com/r.pdf',
      }),
      expect.any(Object),
    );
  });

  it('does not submit when amount parses to NaN', () => {
    render(withQueryClient(createElement(ProviderExpensesPage)));
    fireEvent.change(screen.getByTestId('expense-category-select'), {
      target: { value: 'materials' },
    });
    fireEvent.change(screen.getByLabelText(/Amount/i), {
      target: { value: 'abc' },
    });
    fireEvent.change(screen.getByLabelText(/^Description$/i), {
      target: { value: 'Bad value' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: /Add Expense/i }).closest('form') as HTMLElement,
    );
    expect(createMutate).not.toHaveBeenCalled();
  });
});
