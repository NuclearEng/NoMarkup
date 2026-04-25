// Smoke test for the admin overview page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin',
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

vi.mock('@/hooks/useAdmin', () => ({
  usePlatformMetrics: () => ({ data: undefined, isLoading: false }),
}));

import AdminOverviewPage from '@/app/(dashboard)/admin/page';

describe('AdminOverviewPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(AdminOverviewPage)));
    expect(container).toBeTruthy();
  });

  it('renders the Admin Overview heading', () => {
    const { container } = render(withQueryClient(createElement(AdminOverviewPage)));
    const heading = container.querySelector('h1');
    expect(heading?.textContent).toMatch(/Admin Overview/);
  });
});
