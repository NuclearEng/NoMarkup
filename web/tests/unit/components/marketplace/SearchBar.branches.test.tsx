// SearchBar — branches the main SearchBar.test.tsx does not reach.
// MOCKED: next/navigation and the autocomplete hook (which records the prefix
// it is asked for, so the 200ms debounce is observable).
// PROVEN: default navigation for raw queries / listing / category picks,
// callback overrides, ArrowUp/ArrowDown wrap-around, mouse selection,
// outside-click dismissal, and the loading / no-match / no-price renderings.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SearchBar } from '@/components/marketplace/SearchBar';
import type { AutocompleteSuggestion } from '@/types';

const push = vi.fn<(href: string) => void>();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
}));

const autocomplete: {
  suggestions: AutocompleteSuggestion[] | undefined;
  isLoading: boolean;
  prefixes: string[];
} = { suggestions: undefined, isLoading: false, prefixes: [] };

vi.mock('@/hooks/useListings', () => ({
  useListingsAutocomplete: (prefix: string) => {
    autocomplete.prefixes.push(prefix);
    return {
      data: autocomplete.suggestions ? { suggestions: autocomplete.suggestions } : undefined,
      isLoading: autocomplete.isLoading,
    };
  },
}));

const CATEGORY: AutocompleteSuggestion = {
  type: 'category',
  category_slug: 'goods furniture & decor',
  label: 'Furniture',
};
const CHAIR: AutocompleteSuggestion = {
  type: 'listing',
  id: 'listing-1',
  title: 'Eames lounge chair',
  starting_price_cents: 120000,
};
const OTTOMAN: AutocompleteSuggestion = {
  type: 'listing',
  id: 'listing-2',
  title: 'Eames ottoman',
};

function input(): HTMLElement {
  return screen.getByRole('combobox', { name: 'Search marketplace listings' });
}

/** Type a query and let the 200ms debounce elapse so the dropdown can open. */
function typeAndSettle(value: string) {
  fireEvent.change(input(), { target: { value } });
  act(() => {
    vi.advanceTimersByTime(200);
  });
}

function options(): HTMLElement[] {
  return screen.queryAllByRole('option');
}

function selectedFlags(): (string | null)[] {
  return options().map((o) => o.getAttribute('aria-selected'));
}

beforeEach(() => {
  vi.useFakeTimers();
  push.mockReset();
  autocomplete.suggestions = [CATEGORY, CHAIR, OTTOMAN];
  autocomplete.isLoading = false;
  autocomplete.prefixes = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SearchBar — debounce and dropdown states', () => {
  it('only asks for suggestions 200ms after the seller stops typing', () => {
    render(<SearchBar />);
    fireEvent.change(input(), { target: { value: 'eames' } });
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(autocomplete.prefixes).not.toContain('eames');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input()).toHaveAttribute('aria-expanded', 'false');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(autocomplete.prefixes).toContain('eames');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(input()).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps the dropdown closed for a one-character query', () => {
    render(<SearchBar />);
    typeAndSettle('e');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows "Searching…" while the first results are loading', () => {
    autocomplete.suggestions = undefined;
    autocomplete.isLoading = true;
    render(<SearchBar />);
    typeAndSettle('eames');
    expect(within(screen.getByRole('listbox')).getByText('Searching…')).toBeInTheDocument();
    expect(options()).toHaveLength(0);
  });

  it('names the query when nothing matches', () => {
    autocomplete.suggestions = [];
    render(<SearchBar />);
    typeAndSettle('zzzz');
    expect(screen.getByRole('listbox')).toHaveTextContent('No matches for “zzzz”');
  });

  it('labels categories, and shows a price only on listings that have one', () => {
    render(<SearchBar />);
    typeAndSettle('eames');
    const [category, chair, ottoman] = options();
    expect(category).toHaveTextContent('Category');
    expect(category).toHaveTextContent('Furniture');
    expect(chair).toHaveTextContent('Eames lounge chair');
    expect(chair).toHaveTextContent('$1,200.00');
    expect(ottoman).toHaveTextContent('Eames ottoman');
    expect(ottoman).not.toHaveTextContent('$');
  });

  it('seeds the input and the first lookup from defaultValue', () => {
    render(<SearchBar defaultValue="sofa" />);
    expect(input()).toHaveValue('sofa');
    expect(autocomplete.prefixes[0]).toBe('sofa');
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
    // Not open until the field is focused.
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.focus(input());
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('Clear empties the field, closes the dropdown and returns focus to the input', () => {
    render(<SearchBar />);
    typeAndSettle('eames');
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(input()).toHaveValue('');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    expect(input()).toHaveFocus();
  });
});

describe('SearchBar — submitting the raw query', () => {
  it('navigates to the URL-encoded query on Enter', () => {
    render(<SearchBar />);
    typeAndSettle('  mid-century & teak  ');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/marketplace?q=mid-century%20%26%20teak');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('navigates to the unfiltered marketplace when the query is blank', () => {
    render(<SearchBar />);
    typeAndSettle('   ');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/marketplace');
  });

  it('hands the trimmed query to onSubmitQuery instead of navigating', () => {
    const onSubmitQuery = vi.fn<(query: string) => void>();
    render(<SearchBar onSubmitQuery={onSubmitQuery} />);
    typeAndSettle('  teak desk ');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onSubmitQuery).toHaveBeenCalledWith('teak desk');
    expect(push).not.toHaveBeenCalled();
  });

  it('submits the raw text, not a suggestion, after Escape clears the highlight', () => {
    render(<SearchBar />);
    typeAndSettle('eames');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input()).not.toHaveAttribute('aria-activedescendant');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/marketplace?q=eames');
  });
});

describe('SearchBar — keyboard navigation', () => {
  it('ArrowDown walks forward and wraps from the last suggestion to the first', () => {
    render(<SearchBar />);
    typeAndSettle('eames');
    expect(selectedFlags()).toEqual(['false', 'false', 'false']);
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(selectedFlags()).toEqual(['true', 'false', 'false']);
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(selectedFlags()).toEqual(['false', 'false', 'true']);
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(selectedFlags()).toEqual(['true', 'false', 'false']);
  });

  it('ArrowUp from no highlight jumps to the last suggestion, then walks back', () => {
    render(<SearchBar />);
    typeAndSettle('eames');
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(selectedFlags()).toEqual(['false', 'false', 'true']);
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(selectedFlags()).toEqual(['false', 'true', 'false']);
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(selectedFlags()).toEqual(['false', 'false', 'true']);
  });

  it('points aria-activedescendant at the highlighted option', () => {
    render(<SearchBar />);
    typeAndSettle('eames');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    const active = input().getAttribute('aria-activedescendant');
    expect(active).toBe(options()[1]?.id);
    expect(input().getAttribute('aria-controls')).toBe(screen.getByRole('listbox').id);
  });

  it('arrow keys reopen a dismissed dropdown', () => {
    render(<SearchBar />);
    typeAndSettle('eames');
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('arrow keys do nothing when there are no suggestions, and Enter still submits the text', () => {
    autocomplete.suggestions = [];
    render(<SearchBar />);
    typeAndSettle('zzzz');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(input()).not.toHaveAttribute('aria-activedescendant');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/marketplace?q=zzzz');
  });

  it('Enter on a highlighted listing opens that listing', () => {
    render(<SearchBar />);
    typeAndSettle('eames');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/marketplace/listing-1');
  });

  it('Enter on a highlighted category filters the marketplace by its encoded slug', () => {
    render(<SearchBar />);
    typeAndSettle('eames');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(push).toHaveBeenCalledWith(
      '/marketplace?category_slug=goods%20furniture%20%26%20decor',
    );
  });

  it('ignores keys it does not handle', () => {
    render(<SearchBar />);
    typeAndSettle('eames');
    fireEvent.keyDown(input(), { key: 'Tab' });
    expect(push).not.toHaveBeenCalled();
    expect(selectedFlags()).toEqual(['false', 'false', 'false']);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });
});

describe('SearchBar — mouse', () => {
  it('highlights the hovered suggestion', () => {
    render(<SearchBar />);
    typeAndSettle('eames');
    const ottoman = options()[2];
    if (!ottoman) throw new Error('expected three options');
    fireEvent.mouseEnter(ottoman);
    expect(selectedFlags()).toEqual(['false', 'false', 'true']);
  });

  it('selects on mousedown (before the input can blur) and closes the dropdown', () => {
    render(<SearchBar />);
    typeAndSettle('eames');
    const ottoman = options()[2];
    if (!ottoman) throw new Error('expected three options');
    // preventDefault on mousedown keeps focus in the input.
    expect(fireEvent.mouseDown(ottoman)).toBe(false);
    expect(push).toHaveBeenCalledWith('/marketplace/listing-2');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('hands the picked suggestion to onSelectSuggestion instead of navigating', () => {
    const onSelectSuggestion = vi.fn<(s: AutocompleteSuggestion) => void>();
    render(<SearchBar onSelectSuggestion={onSelectSuggestion} />);
    typeAndSettle('eames');
    const category = options()[0];
    if (!category) throw new Error('expected options');
    fireEvent.mouseDown(category);
    expect(onSelectSuggestion).toHaveBeenCalledWith(CATEGORY);
    expect(push).not.toHaveBeenCalled();
  });

  it('closes without navigating when a suggestion has nothing to link to', () => {
    autocomplete.suggestions = [
      { type: 'listing', title: 'Orphan listing' },
      { type: 'category', label: 'Orphan category' },
    ];
    render(<SearchBar />);
    typeAndSettle('orphan');
    const first = options()[0];
    if (!first) throw new Error('expected options');
    fireEvent.mouseDown(first);
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.focus(input());
    const second = options()[1];
    if (!second) throw new Error('expected options');
    fireEvent.mouseDown(second);
    expect(push).not.toHaveBeenCalled();
  });

  it('closes on a click outside, but not on a click inside the search box', () => {
    render(
      <div>
        <SearchBar />
        <button type="button">Elsewhere</button>
      </div>,
    );
    typeAndSettle('eames');
    fireEvent.mouseDown(input());
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
