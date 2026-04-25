// Smoke test for the (dashboard) root layout.
// AuthGuard, WebSocketProvider and Header are mocked to passthroughs so the
// nav structure renders without needing real auth or WebSocket plumbing.
import { render } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/dashboard',
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

vi.mock('@/components/layout/Header', () => ({
  Header: () => createElement('header', { 'data-testid': 'header' }),
}));

vi.mock('@/components/providers/AuthGuard', () => ({
  AuthGuard: ({ children }: { children: ReactNode }) =>
    createElement('div', { 'data-testid': 'auth-guard' }, children),
}));

vi.mock('@/components/providers/WebSocketProvider', () => ({
  WebSocketProvider: ({ children }: { children: ReactNode }) =>
    createElement('div', { 'data-testid': 'ws-provider' }, children),
}));

vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({ data: { emailVerified: true }, isLoading: false }),
}));

vi.mock('@/lib/api', () => ({
  api: { post: vi.fn(), get: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { id: 'u1', roles: ['customer'] }, isHydrating: false }),
}));

import DashboardLayout from '@/app/(dashboard)/layout';

describe('DashboardLayout', () => {
  it('renders children inside the layout', () => {
    const { container } = render(
      withQueryClient(createElement(DashboardLayout, { children: 'CHILD' })),
    );
    expect(container.textContent).toMatch(/CHILD/);
  });

  it('renders the header', () => {
    const { container } = render(
      withQueryClient(createElement(DashboardLayout, { children: 'x' })),
    );
    expect(container.querySelector('[data-testid="header"]')).toBeTruthy();
  });
});
