// Smoke test for the admin user detail page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/users/abc',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({ id: 'user-1' }),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/hooks/useAdmin', () => ({
  useAdminUser: () => ({ data: undefined, isLoading: true, isError: false }),
  useBanUser: () => ({ mutate: vi.fn(), isPending: false }),
  useSuspendUser: () => ({ mutate: vi.fn(), isPending: false }),
}));

import AdminUserDetailPage from '@/app/(dashboard)/admin/users/[id]/page';

describe('AdminUserDetailPage', () => {
  it('renders without throwing in loading state', () => {
    const { container } = render(withQueryClient(createElement(AdminUserDetailPage)));
    expect(container).toBeTruthy();
  });
});
