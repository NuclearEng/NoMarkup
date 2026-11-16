// /provider/business/quotes — quote template list + create form.
// Covers the feature-flag gate, list states, form validation, the
// dollars-to-cents conversion and the create / delete mutations.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

interface TemplateRow {
  id: string;
  name: string;
  body: string;
  default_amount_cents: number | null;
  use_count: number;
}

const flagState = { enabled: true };

const listState: {
  data: TemplateRow[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
} = { data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() };

const mutateAsync = vi.fn<(input: Record<string, unknown>) => Promise<unknown>>();
const createState = { mutateAsync, isPending: false };

const deleteMutate = vi.fn<(id: string) => void>();
const deleteState = { mutate: deleteMutate, isPending: false };

const useFeatureFlagMock = vi.fn<(key: string) => boolean>();

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/hooks/useFeatureFlags', () => ({
  useFeatureFlag: (key: string) => useFeatureFlagMock(key),
}));

vi.mock('@/hooks/useQuoteTemplates', () => ({
  useQuoteTemplates: () => listState,
  useCreateQuoteTemplate: () => createState,
  useDeleteQuoteTemplate: () => deleteState,
}));

import QuoteTemplatesPage from '@/app/(dashboard)/provider/business/quotes/page';

function renderPage() {
  return render(withQueryClient(createElement(QuoteTemplatesPage)));
}

function fillForm(values: { name?: string; body?: string; amount?: string }) {
  if (values.name !== undefined) {
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: values.name } });
  }
  if (values.body !== undefined) {
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: values.body } });
  }
  if (values.amount !== undefined) {
    fireEvent.change(screen.getByLabelText('Default amount (optional)'), {
      target: { value: values.amount },
    });
  }
}

function save() {
  fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
}

const template: TemplateRow = {
  id: 'tpl-1',
  name: 'Drain unclog',
  body: 'Standard drain service',
  default_amount_cents: 15000,
  use_count: 4,
};

beforeEach(() => {
  vi.clearAllMocks();
  flagState.enabled = true;
  useFeatureFlagMock.mockImplementation(() => flagState.enabled);
  listState.data = undefined;
  listState.isLoading = false;
  listState.isError = false;
  listState.error = null;
  listState.refetch = vi.fn();
  createState.isPending = false;
  deleteState.isPending = false;
  mutateAsync.mockResolvedValue({});
});

describe('QuoteTemplatesPage — feature flag', () => {
  it('reads the provider_business_os flag and hides the form + list when it is off', () => {
    flagState.enabled = false;
    listState.data = [template];
    renderPage();

    expect(useFeatureFlagMock).toHaveBeenCalledWith('provider_business_os');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Quote templates are turned off for this account.',
    );
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(screen.queryByText('Drain unclog')).toBeNull();
  });

  it('links back to the business services hub', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Business Services' })).toHaveAttribute(
      'href',
      '/provider/business',
    );
  });
});

describe('QuoteTemplatesPage — list states', () => {
  it('shows neither the list, the empty copy nor an error while loading', () => {
    listState.isLoading = true;
    renderPage();

    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByText('No quote templates yet.')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    // The create form stays usable while the list loads.
    expect(screen.getByRole('button', { name: 'Save template' })).toBeEnabled();
  });

  it('shows the API error message and retries via refetch', () => {
    const refetch = vi.fn();
    listState.isError = true;
    listState.error = new Error('Gateway unavailable');
    listState.refetch = refetch;
    renderPage();

    expect(screen.getByRole('alert')).toHaveTextContent('Gateway unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to generic copy when the error is not an Error instance', () => {
    listState.isError = true;
    listState.error = 'boom';
    renderPage();

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load quote templates');
  });

  it('shows the empty copy when there are no templates (undefined data defaults to [])', () => {
    renderPage();
    expect(screen.getByText('No quote templates yet.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('renders each template with its amount (or "Amount varies") and use count', () => {
    listState.data = [
      template,
      { id: 'tpl-2', name: 'Custom job', body: 'Priced on site', default_amount_cents: null, use_count: 0 },
    ];
    renderPage();

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Drain unclog');
    expect(items[0]).toHaveTextContent('Standard drain service');
    expect(items[0]).toHaveTextContent('$150.00 · 4 uses');
    expect(items[1]).toHaveTextContent('Amount varies · 0 uses');
    expect(items[1]).not.toHaveTextContent('$');
  });

  it('deletes the clicked template by id', () => {
    listState.data = [template, { ...template, id: 'tpl-2', name: 'Second' }];
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Second' }));
    expect(deleteMutate).toHaveBeenCalledTimes(1);
    expect(deleteMutate).toHaveBeenCalledWith('tpl-2');
  });

  it('disables every delete button while a delete is pending', () => {
    listState.data = [template];
    deleteState.isPending = true;
    renderPage();

    const button = screen.getByRole('button', { name: 'Delete Drain unclog' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(deleteMutate).not.toHaveBeenCalled();
  });
});

describe('QuoteTemplatesPage — create form', () => {
  it('rejects a blank name without calling the mutation', () => {
    renderPage();
    fillForm({ name: '   ', body: 'Some wording' });
    save();

    expect(screen.getByRole('alert')).toHaveTextContent('Name and body are required.');
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only body', () => {
    renderPage();
    fillForm({ name: 'Template', body: '  \n ' });
    save();

    expect(screen.getByRole('alert')).toHaveTextContent('Name and body are required.');
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('rejects a body longer than 4000 characters and shows the live counter', () => {
    renderPage();
    fillForm({ name: 'Template', body: 'x'.repeat(4001) });

    expect(screen.getByText('4001/4000')).toBeInTheDocument();
    save();
    expect(screen.getByRole('alert')).toHaveTextContent('Body must be at most 4000 characters.');
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it.each(['abc', '12.345', '-5', '1,000', '.50'])(
    'rejects the malformed amount %j',
    (amount) => {
      renderPage();
      fillForm({ name: 'Template', body: 'Wording', amount });
      save();

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Enter a valid dollar amount (example 150.00).',
      );
      expect(mutateAsync).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['150', 15000],
    ['150.5', 15050],
    ['150.05', 15005],
    [' 0.99 ', 99],
  ])('converts the amount %j to %d integer cents', async (amount, cents) => {
    renderPage();
    fillForm({ name: '  Drain unclog  ', body: '  Standard wording  ', amount });
    save();

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(mutateAsync).toHaveBeenCalledWith({
      name: 'Drain unclog',
      body: 'Standard wording',
      default_amount_cents: cents,
    });
  });

  it('omits default_amount_cents entirely when the amount is blank', async () => {
    renderPage();
    fillForm({ name: 'No price', body: 'Wording', amount: '   ' });
    save();

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(mutateAsync).toHaveBeenCalledWith({ name: 'No price', body: 'Wording' });
  });

  it('clears the fields after a successful save', async () => {
    renderPage();
    fillForm({ name: 'Saved', body: 'Wording', amount: '20' });
    save();

    await waitFor(() => {
      expect(screen.getByLabelText('Name')).toHaveValue('');
    });
    expect(screen.getByLabelText('Body')).toHaveValue('');
    expect(screen.getByLabelText('Default amount (optional)')).toHaveValue('');
    expect(screen.getByText('0/4000')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('surfaces the API error and keeps the typed values when the save fails', async () => {
    mutateAsync.mockRejectedValue(new Error('Template limit reached'));
    renderPage();
    fillForm({ name: 'Kept', body: 'Wording', amount: '20' });
    save();

    expect(await screen.findByRole('alert')).toHaveTextContent('Template limit reached');
    expect(screen.getByLabelText('Name')).toHaveValue('Kept');
    expect(screen.getByLabelText('Default amount (optional)')).toHaveValue('20');
  });

  it('uses the fallback copy when the save rejects with a non-Error value', async () => {
    mutateAsync.mockRejectedValue('nope');
    renderPage();
    fillForm({ name: 'Kept', body: 'Wording' });
    save();

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the template');
  });

  it('clears a previous validation error on the next valid submit', async () => {
    renderPage();
    save();
    expect(screen.getByRole('alert')).toHaveTextContent('Name and body are required.');

    fillForm({ name: 'Now valid', body: 'Wording' });
    save();
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
    expect(mutateAsync).toHaveBeenCalledWith({ name: 'Now valid', body: 'Wording' });
  });

  it('disables the save button and shows "Saving…" while the create is pending', () => {
    createState.isPending = true;
    renderPage();

    const button = screen.getByRole('button', { name: 'Saving…' });
    expect(button).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save template' })).toBeNull();
  });
});
