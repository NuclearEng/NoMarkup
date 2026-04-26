// Smoke test for the admin layout: verifies access-denied + admin renders.
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

vi.mock('@/components/admin/AdminSidebar', () => ({
  AdminSidebar: () => createElement('div', { 'data-testid': 'admin-sidebar' }),
}));

const mockState: { user: { id: string; roles: string[] } | null } = { user: null };
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: mockState.user }),
}));

import AdminLayout from '@/app/(dashboard)/admin/layout';

describe('AdminLayout', () => {
  it('shows access denied when user is not admin', () => {
    mockState.user = { id: 'u1', roles: ['customer'] };
    const { container } = render(
      withQueryClient(createElement(AdminLayout, { children: 'CHILD' })),
    );
    expect(container.textContent).toMatch(/Access Denied/);
  });

  it('renders children for admin users', () => {
    mockState.user = { id: 'u1', roles: ['admin'] };
    const { container } = render(
      withQueryClient(createElement(AdminLayout, { children: 'CHILD' })),
    );
    expect(container.textContent).toMatch(/CHILD/);
  });

  it('shows access denied when user is null (covers `?? false` fallback)', () => {
    // Forces the null-coalescing branch on line 11 — `user?.roles` short-circuits
    // to `undefined`, then `?? false` provides the fallback.
    mockState.user = null;
    const { container } = render(
      withQueryClient(createElement(AdminLayout, { children: 'CHILD' })),
    );
    expect(container.textContent).toMatch(/Access Denied/);
  });
});
