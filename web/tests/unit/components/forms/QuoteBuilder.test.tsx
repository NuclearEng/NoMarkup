import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createContext, useContext, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateQuoteTemplateInput, QuoteTemplate } from '@/types';

const templatesState: { data: QuoteTemplate[] | undefined; isLoading: boolean } = {
  data: undefined,
  isLoading: false,
};
const createState = { isPending: false };
const createMutateAsync = vi.fn<(input: CreateQuoteTemplateInput) => Promise<unknown>>();
const deleteMutate = vi.fn<(id: string) => void>();
const incrementMutate = vi.fn<(id: string) => void>();

vi.mock('@/hooks/useQuoteTemplates', () => ({
  useQuoteTemplates: () => templatesState,
  useCreateQuoteTemplate: () => ({
    mutateAsync: createMutateAsync,
    get isPending(): boolean {
      return createState.isPending;
    },
  }),
  useDeleteQuoteTemplate: () => ({ mutate: deleteMutate }),
  useIncrementQuoteTemplateUse: () => ({ mutate: incrementMutate }),
}));

// Radix Select needs pointer capture + portals; a listbox of clickable options
// keeps the onValueChange / disabled contract without the jsdom gaps. The extra
// "ghost" option stands in for a template deleted between render and pick.
vi.mock('@/components/ui/select', () => {
  const Ctx = createContext<(v: string) => void>(() => undefined);
  function Select({
    children,
    disabled,
    onValueChange,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    onValueChange?: (v: string) => void;
  }) {
    return (
      <Ctx.Provider value={onValueChange ?? (() => undefined)}>
        <div role="listbox" aria-label="Apply template" aria-disabled={disabled === true}>
          {children}
          <SelectItem value="ghost-template">Ghost</SelectItem>
        </div>
      </Ctx.Provider>
    );
  }
  function SelectItem({ children, value }: { children?: ReactNode; value: string }) {
    const onValueChange = useContext(Ctx);
    return (
      <div
        role="option"
        tabIndex={0}
        aria-selected={false}
        data-value={value}
        onClick={() => {
          onValueChange(value);
        }}
        onKeyDown={() => undefined}
      >
        {children}
      </div>
    );
  }
  return {
    Select,
    SelectItem,
    SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
    SelectTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  };
});

import { QuoteBuilder, type QuoteBuilderValue } from '@/components/forms/QuoteBuilder';

function template(overrides: Partial<QuoteTemplate> & { id: string }): QuoteTemplate {
  return {
    user_id: 'u-1',
    name: `Template ${overrides.id}`,
    body: `Body ${overrides.id}`,
    default_amount_cents: null,
    default_duration_hours: null,
    use_count: 0,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const drain = template({
  id: 't1',
  name: 'Drain unclog',
  body: 'Unclog, 30 min, parts included',
  default_amount_cents: 15000,
  use_count: 3,
});
const inspect = template({ id: 't2', name: 'Inspection', body: 'Visual inspection only', use_count: 1 });

const onChange = vi.fn<(value: QuoteBuilderValue) => void>();

function renderBuilder(value: QuoteBuilderValue, extra: { maxAmountCents?: number; disabled?: boolean } = {}) {
  return render(<QuoteBuilder value={value} onChange={onChange} {...extra} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  templatesState.data = undefined;
  templatesState.isLoading = false;
  createState.isPending = false;
  createMutateAsync.mockResolvedValue({});
});

describe('QuoteBuilder amount and notes', () => {
  it('shows an empty amount for an unset bid and no upper bound by default', () => {
    renderBuilder({ notes: '' });
    const amount = screen.getByLabelText('Bid amount');
    expect(amount).toHaveValue(null);
    expect(amount).not.toHaveAttribute('max');
    expect(screen.getByText('0/4000 characters')).toBeInTheDocument();
  });

  it('shows cents as dollars and caps the input at the job ceiling', () => {
    renderBuilder({ amount_cents: 12345, notes: 'hello' }, { maxAmountCents: 50000 });
    const amount = screen.getByLabelText('Bid amount');
    expect(amount).toHaveValue(123.45);
    expect(amount).toHaveAttribute('max', '500');
    expect(screen.getByText('5/4000 characters')).toBeInTheDocument();
  });

  it('emits rounded cents when a dollar amount is typed and keeps the notes', () => {
    renderBuilder({ notes: 'keep me' });
    fireEvent.change(screen.getByLabelText('Bid amount'), { target: { value: '150.555' } });
    expect(onChange).toHaveBeenCalledWith({ notes: 'keep me', amount_cents: 15056 });
  });

  it('emits an undefined amount when the field is cleared', () => {
    renderBuilder({ amount_cents: 500, notes: 'n' });
    fireEvent.change(screen.getByLabelText('Bid amount'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith({ notes: 'n', amount_cents: undefined });
  });

  it('emits note edits and keeps the amount', () => {
    renderBuilder({ amount_cents: 500, notes: '' });
    fireEvent.change(screen.getByLabelText('Quote details'), { target: { value: 'Two visits' } });
    expect(onChange).toHaveBeenCalledWith({ amount_cents: 500, notes: 'Two visits' });
  });

  it('disables every control when disabled', () => {
    templatesState.data = [drain];
    renderBuilder({ amount_cents: 500, notes: 'has notes' }, { disabled: true });
    expect(screen.getByLabelText('Bid amount')).toBeDisabled();
    expect(screen.getByLabelText('Quote details')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save as template' })).toBeDisabled();
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('QuoteBuilder template picker', () => {
  it('hides the picker and the manage list when the provider has no templates', () => {
    renderBuilder({ notes: '' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.queryByText(/Manage templates/)).not.toBeInTheDocument();
  });

  it('lists templates with a price only when one is saved', () => {
    templatesState.data = [drain, inspect];
    renderBuilder({ notes: '' });
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveTextContent('Drain unclog$150.00');
    expect(options[1]).toHaveTextContent(/^Inspection$/);
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-disabled', 'false');
  });

  it('disables the picker while templates are loading', () => {
    templatesState.data = [drain];
    templatesState.isLoading = true;
    renderBuilder({ notes: '' });
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-disabled', 'true');
  });

  it('applies a template: overwrites notes and amount and bumps its use count', () => {
    templatesState.data = [drain, inspect];
    renderBuilder({ amount_cents: 999, notes: 'draft' });
    fireEvent.click(screen.getByRole('option', { name: /Drain unclog/ }));
    expect(onChange).toHaveBeenCalledWith({
      amount_cents: 15000,
      notes: 'Unclog, 30 min, parts included',
    });
    expect(incrementMutate).toHaveBeenCalledWith('t1');
  });

  it('keeps the current amount when the template has no default price', () => {
    templatesState.data = [drain, inspect];
    renderBuilder({ amount_cents: 999, notes: 'draft' });
    fireEvent.click(screen.getByRole('option', { name: 'Inspection' }));
    expect(onChange).toHaveBeenCalledWith({ amount_cents: 999, notes: 'Visual inspection only' });
    expect(incrementMutate).toHaveBeenCalledWith('t2');
  });

  it('ignores a pick for a template that no longer exists', () => {
    templatesState.data = [drain];
    renderBuilder({ notes: 'draft' });
    fireEvent.click(screen.getByRole('option', { name: 'Ghost' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(incrementMutate).not.toHaveBeenCalled();
  });

  it('shows usage counts and deletes the chosen template', () => {
    templatesState.data = [drain, inspect];
    renderBuilder({ notes: '' });
    expect(screen.getByText('Manage templates (2)')).toBeInTheDocument();
    const row = screen.getByRole('button', { name: 'Delete template Inspection' }).closest('li');
    if (!row) throw new Error('template row missing');
    expect(within(row).getByText('used 1x')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete template Inspection' }));
    expect(deleteMutate).toHaveBeenCalledWith('t2');
  });
});

describe('QuoteBuilder save as template', () => {
  it('cannot save a blank or whitespace-only draft', () => {
    renderBuilder({ notes: '   ' });
    expect(screen.getByRole('button', { name: 'Save as template' })).toBeDisabled();
  });

  it('requires a name, then saves the trimmed name with the draft and closes the dialog', async () => {
    renderBuilder({ amount_cents: 15000, notes: 'Unclog drain' });
    fireEvent.click(screen.getByRole('button', { name: 'Save as template' }));
    const dialog = await screen.findByRole('dialog');
    const save = within(dialog).getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText('Template name'), { target: { value: '   ' } });
    expect(save).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText('Template name'), {
      target: { value: '  Drain basic  ' },
    });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(createMutateAsync).toHaveBeenCalledWith({
      name: 'Drain basic',
      body: 'Unclog drain',
      default_amount_cents: 15000,
    });
  });

  it('cancels without saving and starts with an empty name next time', async () => {
    renderBuilder({ notes: 'Unclog drain' });
    fireEvent.click(screen.getByRole('button', { name: 'Save as template' }));
    fireEvent.change(await screen.findByLabelText('Template name'), { target: { value: 'Half typed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(createMutateAsync).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Save as template' }));
    expect(await screen.findByLabelText('Template name')).toHaveValue('');
  });

  it('shows a saving state while the create request is pending', async () => {
    createState.isPending = true;
    renderBuilder({ notes: 'Unclog drain' });
    fireEvent.click(screen.getByRole('button', { name: 'Save as template' }));
    fireEvent.change(await screen.findByLabelText('Template name'), { target: { value: 'Name' } });
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
  });

  it('does not save if the draft was emptied while the dialog was open', async () => {
    const { rerender } = renderBuilder({ notes: 'Unclog drain' });
    fireEvent.click(screen.getByRole('button', { name: 'Save as template' }));
    fireEvent.change(await screen.findByLabelText('Template name'), { target: { value: 'Name' } });
    rerender(<QuoteBuilder value={{ notes: '' }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(createMutateAsync).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
