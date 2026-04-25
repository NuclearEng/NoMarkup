// Smoke test for the admin users list page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/users',
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
  useAdminUsers: () => ({ data: undefined, isLoading: false, isError: false }),
  useBanUser: () => ({ mutate: vi.fn(), isPending: false }),
  useSuspendUser: () => ({ mutate: vi.fn(), isPending: false }),
}));

import AdminUsersPage from '@/app/(dashboard)/admin/users/page';

describe('AdminUsersPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(AdminUsersPage)));
    expect(container).toBeTruthy();
  });
});
