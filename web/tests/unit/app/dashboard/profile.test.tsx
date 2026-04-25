// Tests for the user profile page — exercises loading/error/success branches,
// provider info card, role badges, edit toggle, and "Become a Provider" button.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const profileState: {
  data: unknown;
  isLoading: boolean;
  error: Error | null;
} = { data: undefined, isLoading: true, error: null };

const providerProfileState: { data: unknown } = { data: undefined };

const enableRoleMutate = vi.fn(() => Promise.resolve({}));
const enableRoleState = { isPending: false };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/profile',
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

vi.mock('@/components/forms/ProfileForm', () => ({
  ProfileForm: ({ onCancel }: { onCancel: () => void }) =>
    createElement(
      'div',
      { 'data-testid': 'profile-form' },
      createElement('button', { type: 'button', onClick: onCancel }, 'cancel-form'),
    ),
}));

vi.mock('@/hooks/useProfile', () => ({
  useEnableRole: () => ({
    mutateAsync: enableRoleMutate,
    isPending: enableRoleState.isPending,
  }),
  useProfile: () => profileState,
}));

vi.mock('@/hooks/useProviderProfile', () => ({
  useProviderProfile: () => providerProfileState,
}));

const { default: ProfilePage } = await import('@/app/(dashboard)/profile/page');

const baseUser = {
  id: 'u1',
  displayName: 'Tanner Coker',
  email: 'tanner@example.com',
  roles: ['customer'],
  emailVerified: true,
  mfaEnabled: false,
  createdAt: '2025-01-15T00:00:00Z',
  avatarUrl: null,
};

beforeEach(() => {
  profileState.data = undefined;
  profileState.isLoading = true;
  profileState.error = null;
  providerProfileState.data = undefined;
  enableRoleState.isPending = false;
  enableRoleMutate.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ProfilePage', () => {
  it('renders loading state while profile is fetching', () => {
    profileState.isLoading = true;
    const { container } = render(withQueryClient(createElement(ProfilePage)));
    expect(container.querySelector('h1')).toBeNull();
  });

  it('renders error state when profile fails to load', () => {
    profileState.isLoading = false;
    profileState.error = new Error('boom');
    render(withQueryClient(createElement(ProfilePage)));
    expect(screen.getByText('Failed to load profile')).toBeDefined();
  });

  it('renders error state when user is missing even without error', () => {
    profileState.isLoading = false;
    profileState.data = null;
    render(withQueryClient(createElement(ProfilePage)));
    expect(screen.getByText('Failed to load profile')).toBeDefined();
  });

  it('renders user information when loaded', () => {
    profileState.isLoading = false;
    profileState.data = baseUser;
    render(withQueryClient(createElement(ProfilePage)));
    expect(screen.getByText('Tanner Coker')).toBeDefined();
    expect(screen.getByText('tanner@example.com')).toBeDefined();
    expect(screen.getByText('Email Verified')).toBeDefined();
    expect(screen.getByText('Disabled')).toBeDefined();
  });

  it('shows "Become a Provider" CTA for customer-only accounts', () => {
    profileState.isLoading = false;
    profileState.data = { ...baseUser, roles: ['customer'] };
    render(withQueryClient(createElement(ProfilePage)));
    expect(screen.getByRole('button', { name: /become a provider/i })).toBeDefined();
  });

  it('hides "Become a Provider" CTA when user is already a provider', () => {
    profileState.isLoading = false;
    profileState.data = { ...baseUser, roles: ['customer', 'provider'] };
    render(withQueryClient(createElement(ProfilePage)));
    expect(screen.queryByRole('button', { name: /become a provider/i })).toBeNull();
  });

  it('hides "Become a Provider" CTA when user is admin', () => {
    profileState.isLoading = false;
    profileState.data = { ...baseUser, roles: ['admin'] };
    render(withQueryClient(createElement(ProfilePage)));
    expect(screen.queryByRole('button', { name: /become a provider/i })).toBeNull();
  });

  it('shows pending state on the role-enable button while mutating', () => {
    profileState.isLoading = false;
    profileState.data = baseUser;
    enableRoleState.isPending = true;
    render(withQueryClient(createElement(ProfilePage)));
    expect(screen.getByRole('button', { name: /setting up/i })).toBeDefined();
  });

  it('switches to edit form when "Edit Profile" clicked', () => {
    profileState.isLoading = false;
    profileState.data = baseUser;
    render(withQueryClient(createElement(ProfilePage)));
    fireEvent.click(screen.getByRole('button', { name: /edit profile/i }));
    expect(screen.getByTestId('profile-form')).toBeDefined();
  });

  it('returns to view from edit form when ProfileForm cancels', () => {
    profileState.isLoading = false;
    profileState.data = baseUser;
    render(withQueryClient(createElement(ProfilePage)));
    fireEvent.click(screen.getByRole('button', { name: /edit profile/i }));
    fireEvent.click(screen.getByText('cancel-form'));
    expect(screen.queryByTestId('profile-form')).toBeNull();
    expect(screen.getByText('Tanner Coker')).toBeDefined();
  });

  it('renders provider information card when provider profile present', () => {
    profileState.isLoading = false;
    profileState.data = { ...baseUser, roles: ['customer', 'provider'] };
    providerProfileState.data = {
      businessName: 'Tanner Plumbing Co',
      serviceCategories: [{ id: 'c1', name: 'Plumbing' }],
      serviceRadiusKm: 25,
      jobsCompleted: 42,
      onTimeRate: 0.95,
      stripeOnboardingComplete: true,
      profileCompleteness: 80,
      bio: 'Bio here',
    };
    render(withQueryClient(createElement(ProfilePage)));
    expect(screen.getByText('Provider Information')).toBeDefined();
    expect(screen.getByText('Tanner Plumbing Co')).toBeDefined();
    expect(screen.getByText('Plumbing')).toBeDefined();
    expect(screen.getByText('Connected')).toBeDefined();
    expect(screen.getByText('95%')).toBeDefined();
  });
});
