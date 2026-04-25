// Smoke test for the admin advances review page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/advances',
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

vi.mock('@/hooks/useWorkingCapital', () => ({
  useAdminAdvances: () => ({ data: undefined, isLoading: false }),
  useDisburseAdvance: () => ({ mutate: vi.fn(), isPending: false }),
  useReviewAdvance: () => ({ mutate: vi.fn(), isPending: false }),
}));

import AdminAdvancesPage from '@/app/(dashboard)/admin/advances/page';

describe('AdminAdvancesPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(AdminAdvancesPage)));
    expect(container).toBeTruthy();
  });
});
