// GoodsCategorySelector — search-first, drill-down goods category picker.
// MOCKED: useGoodsCategoryTree (the DB-backed tree query).
// PROVEN: loading / empty states, search filtering with breadcrumb paths,
// drill-down + breadcrumb navigation, the (id, category) selection callback,
// and how the current value is displayed and marked.
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GoodsCategorySelector } from '@/components/marketplace/GoodsCategorySelector';
import type { ServiceCategory } from '@/types';

const treeState: { data: ServiceCategory[] | undefined; isLoading: boolean } = {
  data: undefined,
  isLoading: false,
};

vi.mock('@/hooks/useCategories', () => ({
  useGoodsCategoryTree: () => treeState,
}));

function cat(
  id: string,
  name: string,
  level: number,
  children: ServiceCategory[] = [],
): ServiceCategory {
  return {
    id,
    parentId: null,
    name,
    slug: id,
    level,
    description: null,
    icon: null,
    sortOrder: 0,
    children,
  };
}

const LAPTOPS = cat('laptops', 'Laptops', 4);
const DESKTOPS = cat('desktops', 'Desktops', 4);
const COMPUTERS = cat('computers', 'Computers', 3, [LAPTOPS, DESKTOPS]);
const PHONES = cat('phones', 'Phones', 3);
const ELECTRONICS = cat('electronics', 'Electronics', 2, [COMPUTERS, PHONES]);
const FURNITURE = cat('furniture', 'Furniture', 2);
// `children` omitted entirely — the API may leave it off leaf nodes.
const TOYS: ServiceCategory = {
  id: 'toys',
  parentId: null,
  name: 'Toys',
  slug: 'toys',
  level: 2,
  description: null,
  icon: null,
  sortOrder: 0,
};

const TREE = [ELECTRONICS, FURNITURE, TOYS];

function browseNames(): string[] {
  const list = screen.getByRole('list', { name: 'Categories' });
  return within(list)
    .getAllByRole('listitem')
    .map((li) => within(li).getAllByRole('button')[0]?.textContent ?? '');
}

function breadcrumb(): string[] {
  const nav = screen.getByRole('navigation', { name: 'Category breadcrumb' });
  return within(nav)
    .getAllByRole('button')
    .map((b) => b.textContent);
}

function search(value: string) {
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search goods categories' }), {
    target: { value },
  });
}

function resultTexts(): string[] {
  const list = screen.getByRole('list', { name: 'Search results' });
  return within(list)
    .queryAllByRole('button')
    .map((b) => b.textContent);
}

beforeEach(() => {
  treeState.data = TREE;
  treeState.isLoading = false;
});

describe('GoodsCategorySelector — query states', () => {
  it('shows a loading message and no picker while the tree loads', () => {
    treeState.data = undefined;
    treeState.isLoading = true;
    render(<GoodsCategorySelector onChange={vi.fn()} />);
    expect(screen.getByText('Loading categories…')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('says no categories are available when the tree is empty', () => {
    treeState.data = [];
    render(<GoodsCategorySelector onChange={vi.fn()} />);
    expect(screen.getByText('No categories available.')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('says no categories are available when the tree never arrived', () => {
    treeState.data = undefined;
    render(<GoodsCategorySelector onChange={vi.fn()} />);
    expect(screen.getByText('No categories available.')).toBeInTheDocument();
  });
});

describe('GoodsCategorySelector — browsing', () => {
  it('lists the top-level categories under an "All goods" breadcrumb', () => {
    render(<GoodsCategorySelector onChange={vi.fn()} />);
    expect(browseNames()).toEqual(['Electronics', 'Furniture', 'Toys']);
    expect(breadcrumb()).toEqual(['All goods']);
  });

  it('offers a drill-down control only for categories that have children', () => {
    render(<GoodsCategorySelector onChange={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: 'Browse Electronics subcategories' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Browse Furniture subcategories' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Browse Toys subcategories' })).toBeNull();
  });

  it('drills down two levels and extends the breadcrumb', () => {
    render(<GoodsCategorySelector onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse Electronics subcategories' }));
    expect(browseNames()).toEqual(['Computers', 'Phones']);
    expect(breadcrumb()).toEqual(['All goods', 'Electronics']);

    fireEvent.click(screen.getByRole('button', { name: 'Browse Computers subcategories' }));
    expect(browseNames()).toEqual(['Laptops', 'Desktops']);
    expect(breadcrumb()).toEqual(['All goods', 'Electronics', 'Computers']);
  });

  it('jumps back to an intermediate level or the root from the breadcrumb', () => {
    render(<GoodsCategorySelector onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse Electronics subcategories' }));
    fireEvent.click(screen.getByRole('button', { name: 'Browse Computers subcategories' }));

    const nav = screen.getByRole('navigation', { name: 'Category breadcrumb' });
    fireEvent.click(within(nav).getByRole('button', { name: 'Electronics' }));
    expect(browseNames()).toEqual(['Computers', 'Phones']);
    expect(breadcrumb()).toEqual(['All goods', 'Electronics']);

    fireEvent.click(within(nav).getByRole('button', { name: 'All goods' }));
    expect(browseNames()).toEqual(['Electronics', 'Furniture', 'Toys']);
    expect(breadcrumb()).toEqual(['All goods']);
  });

  it('reports the picked id together with the full category object', () => {
    const onChange = vi.fn<(id: string, category: ServiceCategory) => void>();
    render(<GoodsCategorySelector onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Furniture' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('furniture', FURNITURE);
  });

  it('lets a parent category itself be picked without drilling in', () => {
    const onChange = vi.fn<(id: string, category: ServiceCategory) => void>();
    render(<GoodsCategorySelector onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Electronics' }));
    expect(onChange).toHaveBeenCalledWith('electronics', ELECTRONICS);
    // Picking does not navigate.
    expect(browseNames()).toEqual(['Electronics', 'Furniture', 'Toys']);
  });

  it('picks a nested category after drilling down', () => {
    const onChange = vi.fn<(id: string, category: ServiceCategory) => void>();
    render(<GoodsCategorySelector onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse Electronics subcategories' }));
    fireEvent.click(screen.getByRole('button', { name: 'Phones' }));
    expect(onChange).toHaveBeenCalledWith('phones', PHONES);
  });
});

describe('GoodsCategorySelector — search', () => {
  it('replaces the browse list with matches from every level, with their paths', () => {
    render(<GoodsCategorySelector onChange={vi.fn()} />);
    search('to');
    expect(screen.queryByRole('list', { name: 'Categories' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Category breadcrumb' })).toBeNull();
    // "Laptops" and "Desktops" are nested; "Toys" is top-level (no path line).
    expect(resultTexts()).toEqual([
      'LaptopsElectronics › Computers',
      'DesktopsElectronics › Computers',
      'Toys',
    ]);
  });

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    render(<GoodsCategorySelector onChange={vi.fn()} />);
    search('  PHONE ');
    expect(resultTexts()).toEqual(['PhonesElectronics']);
  });

  it('names the query when nothing matches', () => {
    render(<GoodsCategorySelector onChange={vi.fn()} />);
    search('zebra');
    expect(resultTexts()).toEqual([]);
    expect(screen.getByText('No categories match “zebra”.')).toBeInTheDocument();
  });

  it('treats a whitespace-only query as no search', () => {
    render(<GoodsCategorySelector onChange={vi.fn()} />);
    search('   ');
    expect(screen.queryByRole('list', { name: 'Search results' })).toBeNull();
    expect(browseNames()).toEqual(['Electronics', 'Furniture', 'Toys']);
  });

  it('picks a deep category straight from the results', () => {
    const onChange = vi.fn<(id: string, category: ServiceCategory) => void>();
    render(<GoodsCategorySelector onChange={onChange} />);
    search('laptop');
    fireEvent.click(screen.getByRole('button', { name: /Laptops/ }));
    expect(onChange).toHaveBeenCalledWith('laptops', LAPTOPS);
  });

  it('caps the results at 50', () => {
    treeState.data = Array.from({ length: 60 }, (_, i) =>
      cat(`widget-${String(i)}`, `Widget ${String(i)}`, 2),
    );
    render(<GoodsCategorySelector onChange={vi.fn()} />);
    search('widget');
    expect(resultTexts()).toHaveLength(50);
  });

  it('returns to the level the seller was browsing when the search is cleared', () => {
    render(<GoodsCategorySelector onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse Electronics subcategories' }));
    search('toys');
    search('');
    expect(browseNames()).toEqual(['Computers', 'Phones']);
  });
});

describe('GoodsCategorySelector — current value', () => {
  it('shows nothing selected and no pressed option without a value', () => {
    render(<GoodsCategorySelector onChange={vi.fn()} />);
    expect(screen.queryByText('›', { exact: false })).toBeNull();
    for (const name of ['Electronics', 'Furniture', 'Toys']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('marks a selected top-level category as pressed and shows it without a path', () => {
    const { container } = render(<GoodsCategorySelector value="furniture" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Furniture' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Electronics' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    const summary = container.querySelector('span.font-medium');
    expect(summary).toHaveTextContent('Furniture');
    expect(summary?.parentElement?.textContent).toBe('Furniture');
  });

  it('shows the full path of a nested selection even while browsing the root', () => {
    const { container } = render(<GoodsCategorySelector value="laptops" onChange={vi.fn()} />);
    const summary = container.querySelector('span.font-medium');
    expect(summary?.parentElement?.textContent).toBe('Electronics › Computers › Laptops');
  });

  it('marks the selected category as pressed in search results', () => {
    render(<GoodsCategorySelector value="laptops" onChange={vi.fn()} />);
    search('tops');
    expect(screen.getByRole('button', { name: /Laptops/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Desktops/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('shows no selection summary for a value that is not in the tree', () => {
    const { container } = render(
      <GoodsCategorySelector value="ai-suggested-slug" onChange={vi.fn()} />,
    );
    expect(container.querySelector('span.font-medium')).toBeNull();
    expect(browseNames()).toEqual(['Electronics', 'Furniture', 'Toys']);
  });

  it('applies the id to the search box and className to the wrapper', () => {
    const { container } = render(
      <GoodsCategorySelector id="listing-category" className="mt-9" onChange={vi.fn()} />,
    );
    expect(screen.getByRole('searchbox')).toHaveAttribute('id', 'listing-category');
    expect(container.firstElementChild).toHaveClass('mt-9');
  });
});
