import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useCategories', () => ({
  useCategoryTree: vi.fn(() => ({
    data: [
      { id: 'cat-1', name: 'Plumbing', level: 0, children: [] },
      { id: 'cat-2', name: 'Electrical', level: 0, children: [] },
    ],
  })),
}));

import { JobSearchFilters } from '@/components/jobs/JobSearchFilters';
import type { SearchJobsParams } from '@/types';

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
});
