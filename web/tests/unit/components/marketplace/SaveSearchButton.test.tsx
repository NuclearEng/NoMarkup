// "Save this search" — persists the active marketplace filters as a standing
// saved search with an alert frequency.
// MOCKED: useCreateSavedSearch (the mutation). PROVEN: the suggested name,
// the frequency choice, the exact payload (runtime-only paging stripped), and
// the pending / empty-name / close-on-success behaviour.
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateSavedSearchInput } from '@/hooks/useWatchlist';
import type { SearchListingsParams } from '@/types';

const mocks = vi.hoisted(() => ({
  mutate:
    vi.fn<
      (input: CreateSavedSearchInput, callbacks?: { onSuccess?: () => void }) => void
    >(),
  state: { isPending: false },
}));

vi.mock('@/hooks/useWatchlist', () => ({
  useCreateSavedSearch: () => ({
    mutate: mocks.mutate,
    isPending: mocks.state.isPending,
  }),
}));

import { SaveSearchButton } from '@/components/marketplace/SaveSearchButton';

function openDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'Save this search' }));
  return screen.getByRole('dialog');
}

function nameInput(): HTMLElement {
  return screen.getByLabelText('Name');
}

function pressedFrequencies(dialog: HTMLElement): string[] {
  return ['Instant', 'Daily', 'Weekly', 'Off'].filter(
    (label) =>
      within(dialog).getByRole('button', { name: label }).getAttribute('aria-pressed') ===
      'true',
  );
}

function savedInput(): CreateSavedSearchInput {
  const input = mocks.mutate.mock.calls[0]?.[0];
  if (!input) throw new Error('expected the save mutation to be called');
  return input;
}

beforeEach(() => {
  mocks.mutate.mockReset();
  mocks.state.isPending = false;
});

describe('SaveSearchButton', () => {
  it('keeps the dialog closed until the button is pressed', () => {
    render(<SaveSearchButton filters={{}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    const dialog = openDialog();
    expect(
      within(dialog).getByText('Get alerted when new auctions match your current filters.'),
    ).toBeInTheDocument();
  });

  it('passes className to the trigger', () => {
    render(<SaveSearchButton filters={{}} className="trigger-class" />);
    expect(screen.getByRole('button', { name: 'Save this search' })).toHaveClass(
      'trigger-class',
    );
  });

  it.each<[string, SearchListingsParams, string]>([
    ['the search text', { query: 'vintage camera', category_id: 'cat-9' }, 'vintage camera'],
    ['the category when there is no text', { category_id: 'cat-9' }, 'Category: cat-9'],
    ['a generic name when nothing is filtered', { sort_by: 'newest' }, 'All auctions'],
  ])('suggests %s as the name', (_label, filters, expected) => {
    render(<SaveSearchButton filters={filters} />);
    openDialog();
    expect(nameInput()).toHaveValue(expected);
  });

  it('defaults the alert frequency to Daily', () => {
    render(<SaveSearchButton filters={{}} />);
    expect(pressedFrequencies(openDialog())).toEqual(['Daily']);
  });

  it('marks only the chosen frequency as pressed', () => {
    render(<SaveSearchButton filters={{}} />);
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Weekly' }));
    expect(pressedFrequencies(dialog)).toEqual(['Weekly']);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Off' }));
    expect(pressedFrequencies(dialog)).toEqual(['Off']);
  });

  it('saves the trimmed name, the chosen frequency and the filters without paging', () => {
    const filters: SearchListingsParams = {
      query: 'sofa',
      category_id: 'cat-1',
      pickup_zip: '94110',
      radius_km: 25,
      min_price_cents: 1000,
      max_price_cents: 20000,
      ending_soon: true,
      sort_by: 'lowest_price',
      page: 3,
      page_size: 60,
    };
    render(<SaveSearchButton filters={filters} />);
    const dialog = openDialog();
    fireEvent.change(nameInput(), { target: { value: '  Cheap sofas nearby  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Instant' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save search' }));

    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    const input = savedInput();
    expect(input.name).toBe('Cheap sofas nearby');
    expect(input.alert_frequency).toBe('instant');
    // What actually goes over the wire: every filter, but not the page the
    // user happened to be on.
    expect(JSON.parse(JSON.stringify(input.query))).toEqual({
      query: 'sofa',
      category_id: 'cat-1',
      pickup_zip: '94110',
      radius_km: 25,
      min_price_cents: 1000,
      max_price_cents: 20000,
      ending_soon: true,
      sort_by: 'lowest_price',
    });
  });

  it('saves with the suggested name and Daily when the user just hits Save', () => {
    render(<SaveSearchButton filters={{ query: 'lego' }} />);
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save search' }));

    const input = savedInput();
    expect(input.name).toBe('lego');
    expect(input.alert_frequency).toBe('daily');
  });

  it('disables Save while the name is empty or only spaces', () => {
    render(<SaveSearchButton filters={{ query: 'lego' }} />);
    const dialog = openDialog();
    const save = within(dialog).getByRole('button', { name: 'Save search' });
    expect(save).toBeEnabled();

    fireEvent.change(nameInput(), { target: { value: '' } });
    expect(save).toBeDisabled();
    fireEvent.change(nameInput(), { target: { value: '   ' } });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(mocks.mutate).not.toHaveBeenCalled();

    fireEvent.change(nameInput(), { target: { value: 'Lego sets' } });
    expect(save).toBeEnabled();
  });

  it('shows "Saving…" and blocks a second submit while the save is in flight', () => {
    mocks.state.isPending = true;
    render(<SaveSearchButton filters={{ query: 'lego' }} />);
    const dialog = openDialog();
    const save = within(dialog).getByRole('button', { name: 'Saving…' });
    expect(save).toBeDisabled();
    expect(within(dialog).queryByRole('button', { name: 'Save search' })).toBeNull();
  });

  it('closes the dialog once the save succeeds', () => {
    mocks.mutate.mockImplementation((_input, callbacks) => {
      callbacks?.onSuccess?.();
    });
    render(<SaveSearchButton filters={{ query: 'lego' }} />);
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save search' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stays open when the save has not succeeded, so the user can retry', () => {
    render(<SaveSearchButton filters={{ query: 'lego' }} />);
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save search' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(nameInput()).toHaveValue('lego');
  });

  it('Cancel closes without saving', () => {
    render(<SaveSearchButton filters={{ query: 'lego' }} />);
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('re-seeds the name and frequency from the current filters each time it opens', () => {
    const { rerender } = render(<SaveSearchButton filters={{ query: 'lego' }} />);
    let dialog = openDialog();
    fireEvent.change(nameInput(), { target: { value: 'My edited name' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Weekly' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    rerender(<SaveSearchButton filters={{ category_id: 'cat-7' }} />);
    dialog = openDialog();
    expect(nameInput()).toHaveValue('Category: cat-7');
    expect(pressedFrequencies(dialog)).toEqual(['Daily']);
  });
});
