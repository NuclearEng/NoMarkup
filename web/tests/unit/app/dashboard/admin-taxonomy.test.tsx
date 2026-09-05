// Smoke + branch tests for the admin taxonomy management page.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/taxonomy',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/hooks/useCategories', () => ({
  useCategoryTree: vi.fn(),
}));

const { useCategoryTree } = await import('@/hooks/useCategories');
const { default: AdminTaxonomyPage } = await import(
  '@/app/(dashboard)/admin/taxonomy/page'
);

function setHooks(opts: { data?: unknown; isLoading?: boolean; isError?: boolean } = {}) {
  vi.mocked(useCategoryTree).mockReturnValue({
    data: opts.data,
    isLoading: opts.isLoading ?? false,
    isError: opts.isError ?? false,
  } as unknown as ReturnType<typeof useCategoryTree>);
}

describe('AdminTaxonomyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setHooks();
  });

  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(AdminTaxonomyPage)));
    expect(container).toBeTruthy();
  });

  it('renders the heading and three summary cards', () => {
    render(withQueryClient(createElement(AdminTaxonomyPage)));
    expect(screen.getByRole('heading', { name: 'Service Taxonomy' })).toBeDefined();
    expect(screen.getByText('Categories')).toBeDefined();
    expect(screen.getByText('Subcategories')).toBeDefined();
    expect(screen.getByText('Service Types')).toBeDefined();
  });

  it('renders skeletons in the summary cards while loading', () => {
    setHooks({ isLoading: true });
    const { container } = render(withQueryClient(createElement(AdminTaxonomyPage)));
    expect(container.querySelectorAll('.bg-muted').length).toBeGreaterThan(0);
  });

  it('renders the error fallback when the tree fails to load', () => {
    setHooks({ isError: true });
    render(withQueryClient(createElement(AdminTaxonomyPage)));
    expect(screen.getByText(/Failed to load categories/)).toBeDefined();
  });

  it('renders the empty state when no categories are returned', () => {
    setHooks({ data: [] });
    render(withQueryClient(createElement(AdminTaxonomyPage)));
    expect(screen.getByText(/No categories found/)).toBeDefined();
  });

  it('renders the category tree with a top-level entry', () => {
    setHooks({
      data: [
        {
          id: 'c1',
          name: 'Home Services',
          description: 'Top-level home services',
          children: [
            {
              id: 'c1-1',
              name: 'Plumbing',
              description: null,
              children: [],
            },
          ],
        },
      ],
    });
    render(withQueryClient(createElement(AdminTaxonomyPage)));
    expect(screen.getByText('Home Services')).toBeDefined();
    // Top-level expanded by default; child label visible too.
    expect(screen.getByText('Plumbing')).toBeDefined();
  });

  it('counts subcategories correctly in the summary card', () => {
    setHooks({
      data: [
        {
          id: 'c1',
          name: 'Home',
          description: null,
          children: [
            { id: 'c1-1', name: 'A', description: null, children: [] },
            { id: 'c1-2', name: 'B', description: null, children: [] },
          ],
        },
      ],
    });
    render(withQueryClient(createElement(AdminTaxonomyPage)));
    // 2 subcategories shown beside the Subcategories label.
    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
  });

  it('collapses a category when its toggle is clicked twice', () => {
    setHooks({
      data: [
        {
          id: 'c1',
          name: 'Home',
          description: null,
          children: [
            { id: 'c1-1', name: 'Plumbing', description: null, children: [] },
          ],
        },
      ],
    });
    render(withQueryClient(createElement(AdminTaxonomyPage)));
    // Top-level is initially expanded — Plumbing visible.
    expect(screen.getByText('Plumbing')).toBeDefined();
    const toggle = screen.getByRole('button', { name: /Home/ });
    fireEvent.click(toggle);
    // After collapsing, Plumbing should no longer be in the document.
    expect(screen.queryByText('Plumbing')).toBeNull();
  });
});
