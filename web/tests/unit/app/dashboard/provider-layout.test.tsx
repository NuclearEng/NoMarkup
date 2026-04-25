// Smoke test for the provider layout: gated for non-providers.
import { render } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/provider',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
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
});
