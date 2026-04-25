import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CategorySelector } from '@/components/providers/CategorySelector';

vi.mock('@/hooks/useCategories', () => ({
  useCategoryTree: vi.fn(() => ({ data: undefined, isLoading: true })),
}));

const { useCategoryTree } = await import('@/hooks/useCategories');

describe('CategorySelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the loading message when categories are loading', () => {
    vi.mocked(useCategoryTree).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof useCategoryTree>);
    render(<CategorySelector selected={[]} onChange={vi.fn()} />);
    expect(screen.getByText(/Loading categories/i)).toBeDefined();
  });

  it('renders the empty state when category tree is empty', () => {
    vi.mocked(useCategoryTree).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useCategoryTree>);
    render(<CategorySelector selected={[]} onChange={vi.fn()} />);
    expect(screen.getByText(/No categories available/i)).toBeDefined();
  });

  it('renders top-level categories from the tree', () => {
    vi.mocked(useCategoryTree).mockReturnValue({
      data: [
        {
          id: 'home',
          parentId: null,
          name: 'Home Services',
          slug: 'home',
          level: 0,
          description: null,
          icon: null,
          sortOrder: 0,
          children: [
            {
              id: 'plumbing',
              parentId: 'home',
              name: 'Plumbing',
              slug: 'plumbing',
              level: 1,
              description: null,
              icon: null,
              sortOrder: 0,
              children: [],
            },
          ],
        },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useCategoryTree>);
    render(<CategorySelector selected={[]} onChange={vi.fn()} />);
    expect(screen.getByText('Home Services')).toBeDefined();
  });

  it('removes a selected category when its remove chip is clicked', async () => {
    const onChange = vi.fn();
    vi.mocked(useCategoryTree).mockReturnValue({
      data: [
        {
          id: 'home',
          parentId: null,
          name: 'Home',
          slug: 'home',
          level: 0,
          description: null,
          icon: null,
          sortOrder: 0,
        },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useCategoryTree>);
    const user = userEvent.setup();
    render(<CategorySelector selected={['home']} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /Remove Home/ }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('filters categories by search input', async () => {
    vi.mocked(useCategoryTree).mockReturnValue({
      data: [
        {
          id: 'home',
          parentId: null,
          name: 'Home Services',
          slug: 'home',
          level: 0,
          description: null,
          icon: null,
          sortOrder: 0,
        },
        {
          id: 'auto',
          parentId: null,
          name: 'Auto Repair',
          slug: 'auto',
          level: 0,
          description: null,
          icon: null,
          sortOrder: 1,
        },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useCategoryTree>);
    const user = userEvent.setup();
    render(<CategorySelector selected={[]} onChange={vi.fn()} />);
    const search = screen.getByLabelText(/Filter categories/);
    await user.type(search, 'auto');
    expect(screen.queryByText('Home Services')).toBeNull();
    expect(screen.getByText('Auto Repair')).toBeDefined();
  });
});
