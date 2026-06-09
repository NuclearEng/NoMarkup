import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { User } from '@/types';
import { USER_ROLE } from '@/types';

// usePathname is the only next/navigation API SidebarNav touches. Pin it so the
// active-link logic is deterministic in jsdom.
let pathname = '/marketplace';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
}));

// Fail-open feature flags (mirror the real accessor) so the working_capital
// gate doesn't depend on a live query.
vi.mock('@/hooks/useFeatureFlags', () => ({
  useFeatureFlag: () => true,
  useFeatureFlags: () => ({}),
}));

import { useAuthStore } from '@/stores/auth-store';

// Pull the layout in after mocks are registered.
const { default: MarketplaceLayout } = await import('@/app/(public)/marketplace/layout');

const AUTHED_USER: User = {
  id: '0190000000000000000000000a',
  email: 'buyer@example.com',
  displayName: 'Buyer',
  avatarUrl: null,
  roles: [USER_ROLE.CUSTOMER],
  status: 'active',
  emailVerified: true,
  phoneVerified: false,
  mfaEnabled: false,
  createdAt: '2026-01-01T00:00:00Z',
};

function renderLayout(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(createElement(QueryClientProvider, { client }, ui));
}

function setAuthed() {
  useAuthStore.setState({ user: AUTHED_USER, isAuthenticated: true, isHydrating: false });
}

function setLoggedOut() {
  useAuthStore.setState({ user: null, isAuthenticated: false, isHydrating: false });
}

function setHydrating() {
  useAuthStore.setState({ user: null, isAuthenticated: false, isHydrating: true });
}

beforeEach(() => {
  pathname = '/marketplace';
});

afterEach(() => {
  useAuthStore.setState({ user: null, isAuthenticated: false, isHydrating: true });
});

describe('marketplace layout — shared dashboard sidebar', () => {
  it('renders the nav sidebar for an authenticated visitor', () => {
    setAuthed();
    renderLayout(
      createElement(MarketplaceLayout, {
        children: createElement('main', { 'data-testid': 'mp-content' }, 'listings'),
      }),
    );

    // The sidebar nav landmark is present...
    expect(screen.getByRole('navigation', { name: /primary navigation/i })).toBeInTheDocument();
    // ...with the canonical dashboard destinations.
    expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /marketplace/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /messages/i })).toBeInTheDocument();
    // The page content still renders alongside it.
    expect(screen.getByTestId('mp-content')).toBeInTheDocument();
  });

  it('marks the Marketplace link active on /marketplace', () => {
    setAuthed();
    renderLayout(
      createElement(MarketplaceLayout, { children: createElement('div', null, 'x') }),
    );
    expect(screen.getByRole('link', { name: /marketplace/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('keeps the sidebar on a marketplace DETAIL route (persistence)', () => {
    pathname = '/marketplace/0190000000000000000000000b';
    setAuthed();
    renderLayout(
      createElement(MarketplaceLayout, { children: createElement('div', null, 'detail') }),
    );
    // Sidebar still present on the detail page, and Marketplace stays active
    // (most-specific-prefix match).
    expect(screen.getByRole('navigation', { name: /primary navigation/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /marketplace/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('renders NO sidebar for a logged-out visitor (public marketplace intact)', () => {
    setLoggedOut();
    renderLayout(
      createElement(MarketplaceLayout, {
        children: createElement('main', { 'data-testid': 'mp-content' }, 'listings'),
      }),
    );
    expect(screen.queryByRole('navigation', { name: /primary navigation/i })).not.toBeInTheDocument();
    // Content is still rendered — logged-out users can still browse.
    expect(screen.getByTestId('mp-content')).toBeInTheDocument();
  });

  it('renders NO sidebar during the auth-restore hydrate window (no flash)', () => {
    setHydrating();
    renderLayout(
      createElement(MarketplaceLayout, { children: createElement('div', null, 'x') }),
    );
    expect(screen.queryByRole('navigation', { name: /primary navigation/i })).not.toBeInTheDocument();
  });
});
