import { fireEvent, render, screen } from '@testing-library/react';
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
});
