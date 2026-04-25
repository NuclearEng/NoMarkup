// Smoke test for the properties management page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/properties',
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

vi.mock('@/hooks/useProperties', () => ({
  useCreateProperty: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteProperty: () => ({ mutate: vi.fn(), isPending: false }),
  useProperties: () => ({ data: undefined, isLoading: false, isError: false }),
}));

import PropertiesPage from '@/app/(dashboard)/properties/page';

describe('PropertiesPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(PropertiesPage)));
    expect(container).toBeTruthy();
  });
});
