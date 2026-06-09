// Tests for the (dashboard) root layout — covers customer / provider / admin
// nav variants, the email verification banner (resend success + dismiss), the
// mobile More drawer (open + close), the active-link highlighting, and the
// Live Demo entry. AuthGuard, WebSocketProvider, and Header are mocked to
// passthroughs so the nav structure renders without real plumbing.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const profileState: {
  data: { emailVerified: boolean; email?: string } | undefined;
  isLoading: boolean;
} = {
  data: { emailVerified: true, email: 'user@example.com' },
  isLoading: false,
};

const authStoreState: {
  user: { id: string; roles: string[] } | null;
  isHydrating: boolean;
} = { user: { id: 'u1', roles: ['customer'] }, isHydrating: false };

const pathnameRef: { current: string } = { current: '/dashboard' };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => pathnameRef.current,
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
  useProfile: () => profileState,
}));

vi.mock('@/lib/api', () => ({
  api: { post: vi.fn(), get: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      user: authStoreState.user,
      isHydrating: authStoreState.isHydrating,
      // DashboardLayout always renders behind AuthGuard, so the shared
      // SidebarNav (which self-gates on auth) always sees an authed user here.
      isAuthenticated: authStoreState.user !== null && !authStoreState.isHydrating,
    }),
}));

const { default: DashboardLayout } = await import('@/app/(dashboard)/layout');

beforeEach(() => {
  profileState.data = { emailVerified: true, email: 'user@example.com' };
  profileState.isLoading = false;
  authStoreState.user = { id: 'u1', roles: ['customer'] };
  authStoreState.isHydrating = false;
  pathnameRef.current = '/dashboard';
});

afterEach(() => {
  vi.clearAllMocks();
});

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

  it('renders provider-specific nav items when user has provider role', () => {
    authStoreState.user = { id: 'u2', roles: ['provider'] };
    render(withQueryClient(createElement(DashboardLayout, { children: 'x' })));
    expect(screen.getAllByText('Provider Dashboard').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Working Capital').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Business Tools').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Challenges').length).toBeGreaterThan(0);
  });

  it('renders admin-specific nav items when user has admin role', () => {
    authStoreState.user = { id: 'u3', roles: ['admin'] };
    render(withQueryClient(createElement(DashboardLayout, { children: 'x' })));
    expect(screen.getAllByText('Admin Panel').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Manage Users').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Disputes').length).toBeGreaterThan(0);
  });

  it('does not render provider nav items for a customer-only user', () => {
    authStoreState.user = { id: 'u1', roles: ['customer'] };
    render(withQueryClient(createElement(DashboardLayout, { children: 'x' })));
    expect(screen.queryByText('Provider Dashboard')).toBeNull();
    expect(screen.queryByText('Admin Panel')).toBeNull();
  });

  it('renders the email verification banner when email not verified', () => {
    profileState.data = { emailVerified: false, email: 'user@example.com' };
    render(withQueryClient(createElement(DashboardLayout, { children: 'x' })));
    expect(screen.getByRole('alert')).toBeDefined();
    expect(
      screen.getByText(/Verify your email address to unlock all features/i),
    ).toBeDefined();
    expect(screen.getByRole('button', { name: /Resend email/i })).toBeDefined();
  });

  it('hides the email verification banner when email is verified', () => {
    profileState.data = { emailVerified: true };
    render(withQueryClient(createElement(DashboardLayout, { children: 'x' })));
    expect(screen.queryByText(/Verify your email/i)).toBeNull();
  });

  it('clicking Resend email calls api.post and shows the success message', async () => {
    profileState.data = { emailVerified: false, email: 'user@example.com' };
    const { api } = await import('@/lib/api');
    vi.mocked(api.post).mockResolvedValueOnce({} as never);
    render(withQueryClient(createElement(DashboardLayout, { children: 'x' })));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Resend email/i }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(vi.mocked(api.post)).toHaveBeenCalledWith(
        '/api/v1/auth/resend-verification',
        { email: 'user@example.com' },
      );
    });
    expect(
      await screen.findByText(/Verification email sent! Check your inbox/i),
    ).toBeDefined();
  });

  it('clicking Resend email handles api errors silently', async () => {
    profileState.data = { emailVerified: false, email: 'user@example.com' };
    const { api } = await import('@/lib/api');
    vi.mocked(api.post).mockRejectedValueOnce(new Error('boom'));
    render(withQueryClient(createElement(DashboardLayout, { children: 'x' })));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Resend email/i }));
      await Promise.resolve();
      await Promise.resolve();
    });
    // Error path: the original prompt is still shown (no success message).
    expect(
      screen.queryByText(/Verification email sent/i),
    ).toBeNull();
  });

  it('clicking Dismiss removes the verification banner', () => {
    profileState.data = { emailVerified: false, email: 'user@example.com' };
    render(withQueryClient(createElement(DashboardLayout, { children: 'x' })));
    fireEvent.click(screen.getByRole('button', { name: /Dismiss verification notice/i }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('opens the More drawer on mobile and closes via the close button', () => {
    render(withQueryClient(createElement(DashboardLayout, { children: 'x' })));
    const moreBtn = screen.getByRole('button', { name: /More navigation options/i });
    fireEvent.click(moreBtn);
    expect(screen.getByRole('dialog', { name: /More navigation/i })).toBeDefined();
    expect(screen.getByText('All Pages')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /Close navigation menu/i }));
    expect(screen.queryByRole('dialog', { name: /More navigation/i })).toBeNull();
  });

  it('clicking the backdrop closes the More drawer', () => {
    render(withQueryClient(createElement(DashboardLayout, { children: 'x' })));
    fireEvent.click(screen.getByRole('button', { name: /More navigation options/i }));
    expect(screen.getByRole('dialog', { name: /More navigation/i })).toBeDefined();
    // The backdrop has aria-hidden and inset-0; click any drawer link to close.
    const backdrop = document.querySelector('[aria-hidden="true"].fixed.inset-0');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as HTMLElement);
    expect(screen.queryByRole('dialog', { name: /More navigation/i })).toBeNull();
  });

  it('marks the active route as aria-current=page', () => {
    pathnameRef.current = '/dashboard';
    render(withQueryClient(createElement(DashboardLayout, { children: 'x' })));
    // Multiple links labelled Dashboard exist (sidebar, mobile drawer, mobile
    // tab bar via "Home"). At least one must be marked aria-current.
    const allLinks = Array.from(document.querySelectorAll('a[aria-current="page"]'));
    expect(allLinks.length).toBeGreaterThan(0);
    expect(
      allLinks.some((a) => a.getAttribute('href') === '/dashboard'),
    ).toBe(true);
  });

  it('treats /jobs/mine as active when pathname starts with it', () => {
    pathnameRef.current = '/jobs/mine/recent';
    render(withQueryClient(createElement(DashboardLayout, { children: 'x' })));
    const allLinks = Array.from(document.querySelectorAll('a[aria-current="page"]'));
    expect(
      allLinks.some((a) => a.getAttribute('href') === '/jobs/mine'),
    ).toBe(true);
  });

  it('does not keep the /provider parent active on a child tab (regression)', () => {
    // Found by dogfooding: visiting /provider/team highlighted BOTH "Team" and
    // "Provider Dashboard" (/provider is a prefix). Most-specific match wins.
    authStoreState.user = { id: 'u2', roles: ['provider'] };
    pathnameRef.current = '/provider/team';
    render(withQueryClient(createElement(DashboardLayout, { children: 'x' })));
    const activeHrefs = Array.from(
      document.querySelectorAll('a[aria-current="page"]'),
    ).map((a) => a.getAttribute('href'));
    expect(activeHrefs).toContain('/provider/team');
    expect(activeHrefs).not.toContain('/provider');
  });

  it('renders the buyer surface nav links (watchlist, saved searches, feed) for any authed user', () => {
    authStoreState.user = { id: 'u1', roles: ['customer'] };
    render(withQueryClient(createElement(DashboardLayout, { children: 'x' })));
    // Common nav items appear for every authenticated user (sidebar + drawer),
    // so there is at least one of each. Assert the new surfaces are linked.
    const watchlist = screen.getAllByText('Watchlist')[0]?.closest('a');
    const savedSearches = screen.getAllByText('Saved Searches')[0]?.closest('a');
    const feed = screen.getAllByText('My Feed')[0]?.closest('a');
    expect(watchlist?.getAttribute('href')).toBe('/me/watchlist');
    expect(savedSearches?.getAttribute('href')).toBe('/me/saved-searches');
    expect(feed?.getAttribute('href')).toBe('/me/feed');
  });

  it('renders Live Demo CTA in both desktop sidebar and mobile drawer', () => {
    render(withQueryClient(createElement(DashboardLayout, { children: 'x' })));
    // One in sidebar, then a second appears once the More drawer opens.
    expect(screen.getAllByText('Live Demo').length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByRole('button', { name: /More navigation options/i }));
    expect(screen.getAllByText('Live Demo').length).toBeGreaterThanOrEqual(2);
  });

  it('uses provider-specific primary tabs when user is a provider', () => {
    authStoreState.user = { id: 'u2', roles: ['provider'] };
    render(withQueryClient(createElement(DashboardLayout, { children: 'x' })));
    // Primary tab bar shows Bids for provider but not Jobs.
    const nav = screen.getByRole('navigation', { name: /Main navigation/i });
    expect(nav.textContent).toMatch(/Bids/);
  });

  it('uses customer-specific primary tabs when user is a customer', () => {
    authStoreState.user = { id: 'u1', roles: ['customer'] };
    render(withQueryClient(createElement(DashboardLayout, { children: 'x' })));
    const nav = screen.getByRole('navigation', { name: /Main navigation/i });
    expect(nav.textContent).toMatch(/Jobs/);
  });

  it('falls back to non-provider, non-admin nav when user is null', () => {
    // Forces the `?? false` branches in `isProvider`/`isAdmin` (lines 165-166).
    authStoreState.user = null;
    render(withQueryClient(createElement(DashboardLayout, { children: 'x' })));
    // No provider or admin nav items should render.
    expect(screen.queryByText('Provider Dashboard')).toBeNull();
    expect(screen.queryByText('Admin Panel')).toBeNull();
    // Customer primary-tab "Jobs" should render (the customer fallback).
    const nav = screen.getByRole('navigation', { name: /Main navigation/i });
    expect(nav.textContent).toMatch(/Jobs/);
  });

  it('clicking a More-drawer nav link closes the drawer', () => {
    // Covers the drawer-link onClick at line 320 — when a user clicks any nav
    // link inside the More drawer, the drawer should close.
    render(withQueryClient(createElement(DashboardLayout, { children: 'x' })));
    fireEvent.click(screen.getByRole('button', { name: /More navigation options/i }));
    const dialog = screen.getByRole('dialog', { name: /More navigation/i });
    expect(dialog).toBeDefined();
    // Click the Profile link inside the drawer (it's a Link → rendered as <a>).
    const profileLink = within(dialog).getByText('Profile').closest('a');
    expect(profileLink).not.toBeNull();
    fireEvent.click(profileLink as HTMLElement);
    expect(screen.queryByRole('dialog', { name: /More navigation/i })).toBeNull();
  });

  it('clicking the More-drawer Live Demo link closes the drawer', () => {
    // Covers the Live Demo onClick at line 332 (the special CTA inside the drawer).
    render(withQueryClient(createElement(DashboardLayout, { children: 'x' })));
    fireEvent.click(screen.getByRole('button', { name: /More navigation options/i }));
    const dialog = screen.getByRole('dialog', { name: /More navigation/i });
    // The drawer contains a second "Live Demo" link.
    const liveDemoLinks = within(dialog).getAllByText('Live Demo');
    expect(liveDemoLinks.length).toBeGreaterThan(0);
    const liveDemoLink = liveDemoLinks[0]?.closest('a');
    expect(liveDemoLink).not.toBeNull();
    fireEvent.click(liveDemoLink as HTMLElement);
    expect(screen.queryByRole('dialog', { name: /More navigation/i })).toBeNull();
  });
});
