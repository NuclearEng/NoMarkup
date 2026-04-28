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

const { api } = (await import('@/lib/api')) as unknown as {
  api: {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
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

  it('disables itself when currentUserId equals sellerId (self-follow)', () => {
    render(
      withProvider(
        <FollowButton sellerId="user-1" currentUserId="user-1" />,
      ),
    );
    const button = screen.getByRole('button');
    expect(button.hasAttribute('disabled')).toBe(true);
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
