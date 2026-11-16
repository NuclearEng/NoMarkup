// GoodsCategorySelector — a failed category load is an error with a Retry, not
// "No categories available."
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GoodsCategorySelector } from '@/components/marketplace/GoodsCategorySelector';
import type { ServiceCategory } from '@/types';

const treeState: {
  data: ServiceCategory[] | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: ReturnType<typeof vi.fn>;
} = { data: undefined, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() };

vi.mock('@/hooks/useCategories', () => ({
  useGoodsCategoryTree: () => treeState,
}));

const FURNITURE: ServiceCategory = {
  id: 'furniture',
  parentId: null,
  name: 'Furniture',
  slug: 'furniture',
  level: 2,
  description: null,
  icon: null,
  sortOrder: 0,
  children: [],
};

beforeEach(() => {
  treeState.data = undefined;
  treeState.isLoading = false;
  treeState.isError = false;
  treeState.isFetching = false;
  treeState.refetch = vi.fn();
});

describe('GoodsCategorySelector — load failure', () => {
  it('shows an error with Retry instead of the empty message', () => {
    treeState.isError = true;
    render(<GoodsCategorySelector onChange={vi.fn()} />);

    expect(screen.getByRole('alert')).toHaveTextContent("We couldn't load the categories");
    expect(screen.queryByText('No categories available.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(treeState.refetch).toHaveBeenCalledTimes(1);
  });

  it('disables Retry while the retry is in flight', () => {
    treeState.isError = true;
    treeState.isFetching = true;
    render(<GoodsCategorySelector onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
  });

  it('keeps the picker when a refresh fails but categories are already loaded', () => {
    treeState.isError = true;
    treeState.data = [FURNITURE];
    render(<GoodsCategorySelector onChange={vi.fn()} />);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Furniture' })).toBeInTheDocument();
  });

  it('still says there are no categories when the load succeeded with none', () => {
    treeState.data = [];
    render(<GoodsCategorySelector onChange={vi.fn()} />);

    expect(screen.getByText('No categories available.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});
