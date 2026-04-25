import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href, ...rest }, children),
}));

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/test',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/components/layout/NotificationBell', () => ({
  NotificationBell: () => createElement('div', { 'data-testid': 'notif-bell' }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: vi.fn(),
}));

import { Header } from '@/components/layout/Header';
import { useAuthStore } from '@/stores/auth-store';
import { USER_ROLE, USER_STATUS } from '@/types';

const baseUser = {
  id: 'user-1',
  email: 'me@example.com',
  displayName: 'Me',
  avatarUrl: null,
  roles: [USER_ROLE.CUSTOMER],
  status: USER_STATUS.ACTIVE,
  emailVerified: true,
  phoneVerified: false,
  mfaEnabled: false,
  createdAt: '2026-01-01T00:00:00Z',
};

const logout = vi.fn(() => Promise.resolve());

function mockAuth(state: { isAuthenticated: boolean; isHydrating?: boolean; user?: typeof baseUser | null }) {
  vi.mocked(useAuthStore).mockReturnValue({
    user: state.user ?? null,
    isAuthenticated: state.isAuthenticated,
    isHydrating: state.isHydrating ?? false,
    logout,
  } as never);
}

beforeEach(() => {
  push.mockClear();
  logout.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('Header', () => {
  it('renders sign-in/get-started CTAs when unauthenticated', () => {
    mockAuth({ isAuthenticated: false });
    render(<Header />);
    expect(screen.getAllByText('Sign in').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Get started').length).toBeGreaterThan(0);
  });

  it('renders user info and notification bell when authenticated', () => {
    mockAuth({ isAuthenticated: true, user: baseUser });
    render(<Header />);
    expect(screen.getByText('Me')).toBeDefined();
    expect(screen.getByTestId('notif-bell')).toBeDefined();
  });

  it('renders Browse Jobs link when authenticated', () => {
    mockAuth({ isAuthenticated: true, user: baseUser });
    render(<Header />);
    expect(screen.getByText('Browse Jobs')).toBeDefined();
  });

  it('renders the Live Demo link in all states', () => {
    mockAuth({ isAuthenticated: false });
    render(<Header />);
    expect(screen.getAllByText('Live Demo').length).toBeGreaterThan(0);
  });

  it('toggles the mobile menu when hamburger is clicked', () => {
    mockAuth({ isAuthenticated: false });
    render(<Header />);
    const hamburger = screen.getByLabelText('Toggle navigation menu');
    expect(hamburger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(hamburger);
    expect(hamburger.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows Provider Dashboard link in mobile menu for provider users', () => {
    mockAuth({
      isAuthenticated: true,
      user: { ...baseUser, roles: [USER_ROLE.PROVIDER, USER_ROLE.CUSTOMER] },
    });
    render(<Header />);
    fireEvent.click(screen.getByLabelText('Toggle navigation menu'));
    expect(screen.getByText('Provider Dashboard')).toBeDefined();
  });

  it('logs out and navigates to login when desktop Sign out clicked', async () => {
    mockAuth({ isAuthenticated: true, user: baseUser });
    const user = userEvent.setup();
    render(<Header />);
    await user.click(screen.getByRole('button', { name: /sign out/i }));
    await waitFor(() => {
      expect(logout).toHaveBeenCalledTimes(1);
    });
    expect(push).toHaveBeenCalledWith('/login');
  });

  it('logs out and navigates to login when mobile Sign out clicked', async () => {
    mockAuth({ isAuthenticated: true, user: baseUser });
    const user = userEvent.setup();
    render(<Header />);
    await user.click(screen.getByLabelText('Toggle navigation menu'));
    const signOutButtons = screen.getAllByRole('button', { name: /sign out/i });
    await user.click(signOutButtons[signOutButtons.length - 1] as HTMLElement);
    await waitFor(() => {
      expect(logout).toHaveBeenCalled();
    });
    expect(push).toHaveBeenCalledWith('/login');
  });

  it('closes the mobile menu when a quick-nav link is clicked', async () => {
    mockAuth({ isAuthenticated: true, user: baseUser });
    const user = userEvent.setup();
    render(<Header />);
    const hamburger = screen.getByLabelText('Toggle navigation menu');
    await user.click(hamburger);
    expect(hamburger.getAttribute('aria-expanded')).toBe('true');
    const dashboardLink = screen.getAllByText('Dashboard')[0];
    if (dashboardLink) {
      await user.click(dashboardLink);
    }
    await waitFor(() => {
      expect(hamburger.getAttribute('aria-expanded')).toBe('false');
    });
  });

  it('toggles the hamburger icon between open and close states', async () => {
    mockAuth({ isAuthenticated: false });
    const user = userEvent.setup();
    render(<Header />);
    const hamburger = screen.getByLabelText('Toggle navigation menu');
    await user.click(hamburger);
    expect(hamburger.getAttribute('aria-expanded')).toBe('true');
    await user.click(hamburger);
    expect(hamburger.getAttribute('aria-expanded')).toBe('false');
  });

  it('renders nothing while hydrating (no nav CTAs)', () => {
    mockAuth({ isAuthenticated: false, isHydrating: true });
    render(<Header />);
    expect(screen.queryByText('Sign in')).toBeNull();
    expect(screen.queryByText('Get started')).toBeNull();
  });

  it('falls back to email when displayName is absent', () => {
    mockAuth({
      isAuthenticated: true,
      user: { ...baseUser, displayName: null as unknown as string },
    });
    render(<Header />);
    expect(screen.getAllByText('me@example.com').length).toBeGreaterThan(0);
  });

  it('renders the dashboard link wrapping the brand when authenticated', () => {
    mockAuth({ isAuthenticated: true, user: baseUser });
    render(<Header />);
    const brandLink = screen.getByLabelText('Go to Dashboard');
    expect(brandLink.getAttribute('href')).toBe('/dashboard');
  });

  it('shows mobile sign-in/get-started CTAs when unauthenticated and menu is open', async () => {
    mockAuth({ isAuthenticated: false });
    const user = userEvent.setup();
    render(<Header />);
    await user.click(screen.getByLabelText('Toggle navigation menu'));
    // Two of each — desktop + mobile
    expect(screen.getAllByText('Sign in').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Get started').length).toBeGreaterThanOrEqual(2);
  });

  it('closes the mobile menu when unauthenticated Sign in link is clicked', async () => {
    mockAuth({ isAuthenticated: false });
    const user = userEvent.setup();
    render(<Header />);
    const hamburger = screen.getByLabelText('Toggle navigation menu');
    await user.click(hamburger);
    const signInLinks = screen.getAllByText('Sign in');
    const mobileSignIn = signInLinks[signInLinks.length - 1];
    if (mobileSignIn) {
      await user.click(mobileSignIn);
    }
    await waitFor(() => {
      expect(hamburger.getAttribute('aria-expanded')).toBe('false');
    });
  });
});
