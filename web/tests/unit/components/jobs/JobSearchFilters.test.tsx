import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useCategories', () => ({
  useCategoryTree: vi.fn(() => ({
    data: [
      {
        id: 'cat-1',
        name: 'Plumbing',
        level: 0,
        children: [
          { id: 'cat-1a', name: 'Drains', level: 1, children: [] },
        ],
      },
      { id: 'cat-2', name: 'Electrical', level: 0, children: [] },
    ],
  })),
}));

import { JobSearchFilters } from '@/components/jobs/JobSearchFilters';
import type { SearchJobsParams } from '@/types';

beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
      ResizeObserverStub;
  }
  // jsdom does not implement these — always stub.
  Element.prototype.hasPointerCapture = (): boolean => false;
  Element.prototype.releasePointerCapture = (): void => {
    // no-op
  };
  Element.prototype.scrollIntoView = (): void => {
    // no-op
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('JobSearchFilters', () => {
  const baseFilters: SearchJobsParams = { page: 1, page_size: 20 };

  it('renders search input with correct label', () => {
    render(<JobSearchFilters filters={baseFilters} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Search')).toBeDefined();
  });

  it('renders category dropdown trigger', () => {
    render(<JobSearchFilters filters={baseFilters} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Category')).toBeDefined();
  });

  it('renders schedule type filter', () => {
    render(<JobSearchFilters filters={baseFilters} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Schedule Type')).toBeDefined();
  });

  it('renders price min/max inputs', () => {
    render(<JobSearchFilters filters={baseFilters} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Minimum price in dollars')).toBeDefined();
    expect(screen.getByLabelText('Maximum price in dollars')).toBeDefined();
  });

  it('renders Reset Filters button that resets state on click', () => {
    const onChange = vi.fn();
    render(
      <JobSearchFilters
        filters={{ ...baseFilters, query: 'something' }}
        onChange={onChange}
      />,
    );
    const resetBtn = screen.getByText('Reset Filters');
    resetBtn.click();
    expect(onChange).toHaveBeenCalledWith({ page: 1, page_size: 20 });
  });

  it('renders the recurring filter checkbox', () => {
    render(<JobSearchFilters filters={baseFilters} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Recurring jobs only')).toBeDefined();
  });

  // ---- DEEPENING ----

  it('renders the location and radius inputs', () => {
    render(<JobSearchFilters filters={baseFilters} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Location filter')).toBeDefined();
    expect(screen.getByLabelText(/Radius/)).toBeDefined();
  });

  it('seeds the search input from the filters.query prop', () => {
    render(
      <JobSearchFilters
        filters={{ ...baseFilters, query: 'leaky faucet' }}
        onChange={vi.fn()}
      />,
    );
    const search = screen.getByLabelText('Search');
    expect((search as HTMLInputElement).value).toBe('leaky faucet');
  });

  it('debounces text-search updates and emits the new query after the timer', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<JobSearchFilters filters={baseFilters} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'plumbing' } });
    // Should NOT have fired immediately
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'plumbing', page: 1 }),
    );
  });

  it('clears the query in onChange when search is emptied', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(
      <JobSearchFilters
        filters={{ ...baseFilters, query: 'old' }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: '' } });
    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ query: undefined, page: 1 }),
    );
  });

  it('emits min_price_cents in cents when min price is typed', () => {
    const onChange = vi.fn();
    render(<JobSearchFilters filters={baseFilters} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Minimum price in dollars'), {
      target: { value: '100' },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ min_price_cents: 10000, page: 1 }),
    );
  });

  it('emits max_price_cents in cents when max price is typed', () => {
    const onChange = vi.fn();
    render(<JobSearchFilters filters={baseFilters} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Maximum price in dollars'), {
      target: { value: '500' },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ max_price_cents: 50000, page: 1 }),
    );
  });

  it('emits min_price_cents=undefined when min price is cleared', () => {
    const onChange = vi.fn();
    render(
      <JobSearchFilters
        filters={{ ...baseFilters, min_price_cents: 5000 }}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('Minimum price in dollars'), {
      target: { value: '' },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ min_price_cents: undefined, page: 1 }),
    );
  });

  it('seeds price inputs from filters props in dollars', () => {
    render(
      <JobSearchFilters
        filters={{ ...baseFilters, min_price_cents: 2500, max_price_cents: 10000 }}
        onChange={vi.fn()}
      />,
    );
    const min = screen.getByLabelText('Minimum price in dollars');
    const max = screen.getByLabelText('Maximum price in dollars');
    expect((min as HTMLInputElement).value).toBe('25');
    expect((max as HTMLInputElement).value).toBe('100');
  });

  it('emits radius_km when radius is typed', () => {
    const onChange = vi.fn();
    render(<JobSearchFilters filters={baseFilters} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/Radius/), {
      target: { value: '50' },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ radius_km: 50, page: 1 }),
    );
  });

  it('emits is_recurring=true when the recurring checkbox is checked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<JobSearchFilters filters={baseFilters} onChange={onChange} />);

    const checkbox = screen.getByLabelText('Recurring jobs only');
    await user.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ is_recurring: true, page: 1 }),
    );
  });

  it('emits is_recurring=undefined when the recurring checkbox is unchecked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <JobSearchFilters
        filters={{ ...baseFilters, is_recurring: true }}
        onChange={onChange}
      />,
    );

    const checkbox = screen.getByLabelText('Recurring jobs only');
    await user.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ is_recurring: undefined, page: 1 }),
    );
  });

  it('preserves page_size when Reset Filters is clicked', () => {
    const onChange = vi.fn();
    render(
      <JobSearchFilters
        filters={{ ...baseFilters, page_size: 50, query: 'old', is_recurring: true }}
        onChange={onChange}
      />,
    );
    screen.getByText('Reset Filters').click();
    expect(onChange).toHaveBeenCalledWith({ page: 1, page_size: 50 });
  });

  it('clears the local search input visually when Reset Filters is clicked', () => {
    render(
      <JobSearchFilters
        filters={{ ...baseFilters, query: 'pipe' }}
        onChange={vi.fn()}
      />,
    );
    const search = screen.getByLabelText('Search');
    expect((search as HTMLInputElement).value).toBe('pipe');
    act(() => {
      fireEvent.click(screen.getByText('Reset Filters'));
    });
    expect((search as HTMLInputElement).value).toBe('');
  });

  it('renders flattened category options including child entries', async () => {
    const user = userEvent.setup();
    render(<JobSearchFilters filters={baseFilters} onChange={vi.fn()} />);

    // Open the category select
    await user.click(screen.getByLabelText('Category'));
    expect(await screen.findByRole('option', { name: /Plumbing/ })).toBeDefined();
    // Child should also be available (with indentation)
    expect(screen.getByRole('option', { name: /Drains/ })).toBeDefined();
    expect(screen.getByRole('option', { name: /Electrical/ })).toBeDefined();
    expect(screen.getByRole('option', { name: /All Categories/ })).toBeDefined();
  });

  // ---- DEEPENING: schedule_type Select onValueChange (lines 124-128) ----

  it('emits schedule_type=specific_date when Specific Date option is chosen', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<JobSearchFilters filters={baseFilters} onChange={onChange} />);

    await user.click(screen.getByLabelText('Schedule Type'));
    const opt = await screen.findByRole('option', { name: 'Specific Date' });
    await user.click(opt);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ schedule_type: 'specific_date', page: 1 }),
    );
  });

  it('emits schedule_type=undefined when Any Schedule is chosen', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <JobSearchFilters
        filters={{ ...baseFilters, schedule_type: 'flexible' }}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByLabelText('Schedule Type'));
    const opt = await screen.findByRole('option', { name: 'Any Schedule' });
    await user.click(opt);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ schedule_type: undefined, page: 1 }),
    );
  });

  // ---- DEEPENING: locationText onChange (lines 186-187) ----

  it('updates the location input value as the user types', () => {
    render(<JobSearchFilters filters={baseFilters} onChange={vi.fn()} />);
    const loc = screen.getByLabelText('Location filter') as HTMLInputElement;
    fireEvent.change(loc, { target: { value: 'San Francisco' } });
    expect(loc.value).toBe('San Francisco');
  });

  // ---- DEEPENING: category Select onValueChange to ensure both branches hit ----

  it('emits category_id when a Category option is chosen', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<JobSearchFilters filters={baseFilters} onChange={onChange} />);

    await user.click(screen.getByLabelText('Category'));
    const opt = await screen.findByRole('option', { name: /Electrical/ });
    await user.click(opt);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ category_id: 'cat-2', page: 1 }),
    );
  });

  it('emits category_id=undefined when All Categories is chosen', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <JobSearchFilters
        filters={{ ...baseFilters, category_id: 'cat-1' }}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByLabelText('Category'));
    const opt = await screen.findByRole('option', { name: /All Categories/ });
    await user.click(opt);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ category_id: undefined, page: 1 }),
    );
  });

  it('emits radius_km=undefined when radius input is cleared', () => {
    const onChange = vi.fn();
    render(
      <JobSearchFilters
        filters={{ ...baseFilters, radius_km: 50 }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Radius/), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ radius_km: undefined, page: 1 }),
    );
  });
});
