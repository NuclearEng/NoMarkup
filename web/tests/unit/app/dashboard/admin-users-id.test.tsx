// Tests for the admin user detail page — exercises loading, error, profile rendering,
// suspend/ban dialog flow, reason textarea, and provider profile branch.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const userState: {
  data: { user: Record<string, unknown> } | undefined;
  isLoading: boolean;
  isError: boolean;
} = { data: undefined, isLoading: true, isError: false };

const suspendMutate = vi.fn(() => Promise.resolve({}));
const banMutate = vi.fn(() => Promise.resolve({}));
const suspendState = { isPending: false };
const banState = { isPending: false };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/users/user-1',
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
  useAdminUser: () => userState,
  useSuspendUser: () => ({ mutateAsync: suspendMutate, isPending: suspendState.isPending }),
  useBanUser: () => ({ mutateAsync: banMutate, isPending: banState.isPending }),
}));

// Stub HTMLDialogElement methods (jsdom does not implement them).
HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
  this.removeAttribute('open');
};

const { default: AdminUserDetailPage } = await import('@/app/(dashboard)/admin/users/[id]/page');

function makeUser(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'user-1',
    display_name: 'Jane Doe',
    email: 'jane@example.com',
    phone: '+15551234567',
    status: 'active',
    roles: ['customer'],
    email_verified: true,
    phone_verified: false,
    created_at: '2025-01-15T10:00:00Z',
    last_login_at: '2026-04-20T08:30:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  userState.data = undefined;
  userState.isLoading = true;
  userState.isError = false;
  suspendState.isPending = false;
  banState.isPending = false;
  suspendMutate.mockClear();
  banMutate.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AdminUserDetailPage', () => {
  it('renders without throwing in loading state', () => {
    const { container } = render(withQueryClient(createElement(AdminUserDetailPage)));
    expect(container).toBeTruthy();
  });

  it('renders error state when fetch fails', () => {
    userState.isLoading = false;
    userState.isError = true;
    render(withQueryClient(createElement(AdminUserDetailPage)));
    expect(screen.getByText(/Failed to load user details/i)).toBeDefined();
  });

  it('renders error state when no user data returned', () => {
    userState.isLoading = false;
    userState.data = undefined;
    render(withQueryClient(createElement(AdminUserDetailPage)));
    expect(screen.getByText(/Failed to load user details/i)).toBeDefined();
  });

  it('renders user profile fields when loaded', () => {
    userState.isLoading = false;
    userState.data = { user: makeUser() };
    render(withQueryClient(createElement(AdminUserDetailPage)));
    expect(screen.getAllByText(/Jane Doe/).length).toBeGreaterThan(0);
    expect(screen.getByText('jane@example.com')).toBeDefined();
    expect(screen.getByText('+15551234567')).toBeDefined();
  });

  it('renders "Never" when no last_login_at', () => {
    userState.isLoading = false;
    userState.data = { user: makeUser({ last_login_at: null }) };
    render(withQueryClient(createElement(AdminUserDetailPage)));
    expect(screen.getByText('Never')).toBeDefined();
  });

  it('renders N/A for missing phone', () => {
    userState.isLoading = false;
    userState.data = { user: makeUser({ phone: '' }) };
    render(withQueryClient(createElement(AdminUserDetailPage)));
    expect(screen.getAllByText('N/A').length).toBeGreaterThan(0);
  });

  it('disables Suspend button when user already suspended', () => {
    userState.isLoading = false;
    userState.data = { user: makeUser({ status: 'suspended' }) };
    render(withQueryClient(createElement(AdminUserDetailPage)));
    const btn = screen.getByLabelText(/Suspend this user/i);
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables Ban button when user already banned', () => {
    userState.isLoading = false;
    userState.data = { user: makeUser({ status: 'banned' }) };
    render(withQueryClient(createElement(AdminUserDetailPage)));
    const btn = screen.getByLabelText(/Ban this user/i);
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens suspend dialog when Suspend clicked', () => {
    userState.isLoading = false;
    userState.data = { user: makeUser() };
    render(withQueryClient(createElement(AdminUserDetailPage)));
    fireEvent.click(screen.getByLabelText(/Suspend this user/i));
    expect(screen.getByText(/Suspend Jane Doe/)).toBeDefined();
    expect(screen.getByText(/temporarily suspend the user account/i)).toBeDefined();
  });

  it('opens ban dialog when Ban clicked', () => {
    userState.isLoading = false;
    userState.data = { user: makeUser() };
    render(withQueryClient(createElement(AdminUserDetailPage)));
    fireEvent.click(screen.getByLabelText(/Ban this user/i));
    expect(screen.getByText(/Ban Jane Doe/)).toBeDefined();
    expect(screen.getByText(/permanently ban the user/i)).toBeDefined();
  });

  it('updates the reason textarea when user types', () => {
    userState.isLoading = false;
    userState.data = { user: makeUser() };
    render(withQueryClient(createElement(AdminUserDetailPage)));
    fireEvent.click(screen.getByLabelText(/Suspend this user/i));
    const textarea = screen.getByLabelText(/^Reason$/i);
    fireEvent.change(textarea, { target: { value: 'Inappropriate behavior' } });
    expect((textarea as HTMLTextAreaElement).value).toBe('Inappropriate behavior');
  });

  it('renders provider profile section when user has provider_profile', () => {
    userState.isLoading = false;
    userState.data = {
      user: makeUser({
        provider_profile: {
          display_name: 'Doe Plumbing',
          business_name: 'Doe LLC',
          bio: 'Family-run plumbing business.',
          trust_score: 0.85,
          trust_tier: 'verified',
          jobs_completed: 42,
          average_rating: 4.7,
          total_reviews: 30,
        },
      }),
    };
    render(withQueryClient(createElement(AdminUserDetailPage)));
    expect(screen.getByText(/Provider Profile/i)).toBeDefined();
    expect(screen.getByText('Doe Plumbing')).toBeDefined();
    expect(screen.getByText(/Family-run plumbing business/)).toBeDefined();
    expect(screen.getByText('85')).toBeDefined();
  });
});
