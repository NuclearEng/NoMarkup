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

  it('drills down into a parent category when clicked', async () => {
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
    const user = userEvent.setup();
    render(<CategorySelector selected={[]} onChange={vi.fn()} />);
    // Top level: Home is a Button; drill down
    await user.click(screen.getByRole('button', { name: /home/i }));
    // After drilling in, "Plumbing" is now visible as a leaf checkbox label
    expect(screen.getByText('Plumbing')).toBeDefined();
    // Breadcrumb shows All > Home
    expect(screen.getByRole('button', { name: /^all$/i })).toBeDefined();
  });

  it('toggles a leaf category and calls onChange with the id', async () => {
    const onChange = vi.fn();
    vi.mocked(useCategoryTree).mockReturnValue({
      data: [
        {
          id: 'plumbing',
          parentId: null,
          name: 'Plumbing',
          slug: 'plumbing',
          level: 0,
          description: null,
          icon: null,
          sortOrder: 0,
          children: [],
        },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useCategoryTree>);
    const user = userEvent.setup();
    render(<CategorySelector selected={[]} onChange={onChange} />);
    const checkbox = screen.getByRole('checkbox', { name: /plumbing/i });
    await user.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(['plumbing']);
  });

  it('unchecking an already-selected leaf removes it from the array', async () => {
    const onChange = vi.fn();
    vi.mocked(useCategoryTree).mockReturnValue({
      data: [
        {
          id: 'plumbing',
          parentId: null,
          name: 'Plumbing',
          slug: 'plumbing',
          level: 0,
          description: null,
          icon: null,
          sortOrder: 0,
          children: [],
        },
        {
          id: 'electrical',
          parentId: null,
          name: 'Electrical',
          slug: 'electrical',
          level: 0,
          description: null,
          icon: null,
          sortOrder: 1,
          children: [],
        },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useCategoryTree>);
    const user = userEvent.setup();
    render(<CategorySelector selected={['plumbing', 'electrical']} onChange={onChange} />);
    const checkbox = screen.getByRole('checkbox', { name: /^plumbing$/i });
    await user.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(['electrical']);
  });

  it('disables checkbox once max selections reached for unselected items', () => {
    const tenIds = Array.from({ length: 10 }, (_, i) => `cat-${String(i)}`);
    const tree = tenIds.map((id, i) => ({
      id,
      parentId: null,
      name: `Cat ${String(i)}`,
      slug: id,
      level: 0,
      description: null,
      icon: null,
      sortOrder: i,
      children: [],
    }));
    tree.push({
      id: 'extra',
      parentId: null,
      name: 'Extra',
      slug: 'extra',
      level: 0,
      description: null,
      icon: null,
      sortOrder: 99,
      children: [],
    });
    vi.mocked(useCategoryTree).mockReturnValue({
      data: tree,
      isLoading: false,
    } as unknown as ReturnType<typeof useCategoryTree>);
    render(<CategorySelector selected={tenIds} onChange={vi.fn()} />);
    const extra = screen.getByRole('checkbox', { name: /^extra$/i });
    expect(extra.hasAttribute('disabled')).toBe(true);
  });

  it('renders the selection count "n/10"', () => {
    vi.mocked(useCategoryTree).mockReturnValue({
      data: [
        {
          id: 'plumbing',
          parentId: null,
          name: 'Plumbing',
          slug: 'plumbing',
          level: 0,
          description: null,
          icon: null,
          sortOrder: 0,
          children: [],
        },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useCategoryTree>);
    render(<CategorySelector selected={['plumbing']} onChange={vi.fn()} />);
    expect(screen.getByText('1/10')).toBeDefined();
  });

  it('breadcrumb All button resets back to top level', async () => {
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
        {
          id: 'auto',
          parentId: null,
          name: 'Auto',
          slug: 'auto',
          level: 0,
          description: null,
          icon: null,
          sortOrder: 1,
          children: [
            {
              id: 'tires',
              parentId: 'auto',
              name: 'Tires',
              slug: 'tires',
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
    const user = userEvent.setup();
    render(<CategorySelector selected={[]} onChange={vi.fn()} />);
    // Drill into Home
    await user.click(screen.getByRole('button', { name: /^home$/i }));
    expect(screen.getByText('Plumbing')).toBeDefined();
    // Click All breadcrumb
    await user.click(screen.getByRole('button', { name: /^all$/i }));
    // Back at top level — both Home and Auto visible
    expect(screen.getByRole('button', { name: /^home$/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /^auto$/i })).toBeDefined();
  });

  it('shows empty filter results when search has no matches', async () => {
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
          children: [],
        },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useCategoryTree>);
    const user = userEvent.setup();
    render(<CategorySelector selected={[]} onChange={vi.fn()} />);
    await user.type(screen.getByLabelText(/Filter categories/), 'zzz-no-match');
    expect(screen.getByText(/No categories match your search/)).toBeDefined();
  });
});
