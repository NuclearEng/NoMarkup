import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FollowButton } from '@/components/users/FollowButton';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    userMessage(fallback: string) {
      return this.message || fallback;
    }
  },
}));

// FollowButton reads getAccessToken() to decide whether a click toggles the
// follow (logged in) or prompts sign-in (logged out). Default: logged in, so
// the existing toggle tests exercise the mutation path. The logged-out case
// is overridden per-test.
vi.mock('@/lib/auth', () => ({
  getAccessToken: vi.fn(() => 'test-token'),
}));

const { api } = (await import('@/lib/api')) as unknown as {
  api: {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
};

const { getAccessToken } = (await import('@/lib/auth')) as unknown as {
  getAccessToken: ReturnType<typeof vi.fn>;
};

function withProvider(children: ReactNode): ReactNode {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('FollowButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default to logged-in for the toggle tests; the logged-out test overrides.
    getAccessToken.mockReturnValue('test-token');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the Follow label by default', () => {
    render(withProvider(<FollowButton sellerId="seller-1" />));
    expect(screen.getByRole('button')).toBeDefined();
    expect(screen.getByText('Follow')).toBeDefined();
  });

  it('renders Following when initialFollowing=true', () => {
    render(<>{withProvider(<FollowButton sellerId="seller-1" initialFollowing />)}</>);
    expect(screen.getByText('Following')).toBeDefined();
  });

  it('calls the follow API and optimistically flips state on click', async () => {
    api.post.mockResolvedValue({ following: true, follower_count: 1 });
    render(withProvider(<FollowButton sellerId="seller-1" />));
    const button = screen.getByRole('button');
    fireEvent.click(button);
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/api/v1/users/seller-1/follow');
    });
    // Optimistic flip happened.
    expect(screen.getByText('Following')).toBeDefined();
  });

  // Public-funnel guard: a logged-out visitor on the public seller profile must
  // be prompted to sign in (clean nav to /login) rather than firing the
  // auth-gated follow mutation — which would 401 and bounce them off the page.
  it('redirects a logged-out visitor to /login instead of calling the API', async () => {
    getAccessToken.mockReturnValue(null);
    const original = window.location;
    const hrefSetter = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...original,
        get href() {
          return '';
        },
        set href(v: string) {
          hrefSetter(v);
        },
      },
    });

    render(withProvider(<FollowButton sellerId="seller-1" />));
    fireEvent.click(screen.getByRole('button'));

    expect(hrefSetter).toHaveBeenCalledWith('/login');
    expect(api.post).not.toHaveBeenCalled();
    // No optimistic flip — still shows "Follow".
    expect(screen.getByText('Follow')).toBeDefined();

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: original,
    });
  });

  it('disables itself when currentUserId equals sellerId (self-follow)', () => {
    render(
      withProvider(
        <FollowButton sellerId="user-1" currentUserId="user-1" />,
      ),
    );
    const button = screen.getByRole('button');
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  // Bug 3 — the self-guard must render the "You" label, not "Follow".
  it('renders the "You" label on the self-guard button', () => {
    render(
      withProvider(<FollowButton sellerId="user-1" currentUserId="user-1" />),
    );
    expect(screen.getByText('You')).toBeDefined();
    expect(screen.queryByText('Follow')).toBeNull();
  });

  it('does not self-guard when currentUserId differs from sellerId', () => {
    render(
      withProvider(<FollowButton sellerId="seller-1" currentUserId="someone-else" />),
    );
    const button = screen.getByRole('button');
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(screen.getByText('Follow')).toBeDefined();
  });

  // Bug 3 — followerCount renders as a suffix so the profile shows social proof.
  it('renders the follower count suffix when provided', () => {
    render(
      withProvider(
        <FollowButton sellerId="seller-1" initialFollowing followerCount={42} />,
      ),
    );
    expect(screen.getByText('42')).toBeDefined();
    expect(screen.getByText('Following')).toBeDefined();
  });

  it('stops click propagation so a parent handler is not invoked', () => {
    const parentClick = vi.fn();
    api.post.mockResolvedValue({ following: true, follower_count: 1 });
    // Wrap in a real interactive role + key handler to satisfy jsx-a11y.
    render(
      withProvider(
        <div
          role="button"
          tabIndex={0}
          onClick={parentClick}
          onKeyDown={parentClick}
        >
          <FollowButton sellerId="seller-1" />
        </div>,
      ),
    );
    // The inner FollowButton — querying by accessible name disambiguates.
    fireEvent.click(screen.getByRole('button', { name: /Follow seller/i }));
    expect(parentClick).not.toHaveBeenCalled();
  });
});
