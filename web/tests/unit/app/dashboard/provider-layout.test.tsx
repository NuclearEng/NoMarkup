// Smoke test for the provider layout: gated for non-providers.
import { render } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const mockPathname: { value: string } = { value: '/provider' };
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => mockPathname.value,
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({
    children,
    href,
    ...rest
  }: { children: ReactNode; href: string } & Record<string, unknown>) =>
    createElement('a', { href, ...rest }, children),
}));

const mockState: { user: { id: string; roles: string[] } | null; isHydrating: boolean } = {
  user: null,
  isHydrating: false,
};
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: mockState.user, isHydrating: mockState.isHydrating }),
}));

import ProviderLayout from '@/app/(dashboard)/provider/layout';

describe('ProviderLayout', () => {
  it('shows gating when user is not a provider', () => {
    mockState.user = { id: 'u1', roles: ['customer'] };
    mockState.isHydrating = false;
    const { container } = render(
      withQueryClient(createElement(ProviderLayout, { children: 'CHILD' })),
    );
    expect(container.textContent).toMatch(/Provider Access Required/);
  });

  it('renders children for provider users', () => {
    mockState.user = { id: 'u1', roles: ['provider'] };
    mockState.isHydrating = false;
    const { container } = render(
      withQueryClient(createElement(ProviderLayout, { children: 'CHILD' })),
    );
    expect(container.textContent).toMatch(/CHILD/);
  });

  it('shows a loading spinner during hydration', () => {
    mockState.user = null;
    mockState.isHydrating = true;
    const { container } = render(
      withQueryClient(createElement(ProviderLayout, { children: 'CHILD' })),
    );
    expect(container.querySelector('.animate-spin')).toBeTruthy();
  });

  it('marks the current nav item as active when pathname matches', () => {
    mockState.user = { id: 'u1', roles: ['provider'] };
    mockState.isHydrating = false;
    mockPathname.value = '/provider/offers';
    const { container } = render(
      withQueryClient(createElement(ProviderLayout, { children: 'CHILD' })),
    );
    const activeLink = container.querySelector('a[aria-current="page"]');
    expect(activeLink).toBeTruthy();
    expect(activeLink?.getAttribute('href')).toBe('/provider/offers');
    mockPathname.value = '/provider';
  });
});
