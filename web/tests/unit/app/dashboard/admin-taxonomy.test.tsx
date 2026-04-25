// Smoke test for the admin taxonomy management page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

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
  useCategoryTree: () => ({ data: undefined, isLoading: false, isError: false }),
}));

import AdminTaxonomyPage from '@/app/(dashboard)/admin/taxonomy/page';

describe('AdminTaxonomyPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(AdminTaxonomyPage)));
    expect(container).toBeTruthy();
  });
});
