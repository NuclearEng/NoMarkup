// Provider detail page (`/providers/[id]`) — covers loading, error, and
// success states. Uses useParams() from next/navigation to read the route
// param.
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/providers/test-id',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({ id: 'test-id' }),
}));

vi.mock('@/hooks/useProviders', () => ({
  usePublicProviderProfile: vi.fn(),
}));

vi.mock('@/hooks/useReviews', () => ({
  useReviewsForUser: vi.fn(() => ({ data: { reviews: [] } })),
}));

const { usePublicProviderProfile } = await import('@/hooks/useProviders');
const { default: ProviderProfilePage } = await import('@/app/(public)/providers/[id]/page');

describe('(public)/providers/[id]/page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the loading skeleton', () => {
    vi.mocked(usePublicProviderProfile).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof usePublicProviderProfile>);

    const { container } = render(createElement(ProviderProfilePage));
    // Skeleton renders animate-pulse divs but no headings
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders the error state with retry button', () => {
    vi.mocked(usePublicProviderProfile).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof usePublicProviderProfile>);

    render(createElement(ProviderProfilePage));
    expect(screen.getByText(/Failed to load provider profile/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined();
  });

  it('renders provider profile when loaded', () => {
    vi.mocked(usePublicProviderProfile).mockReturnValue({
      data: {
        user_id: 'u1',
        display_name: 'Jane Provider',
        business_name: 'Jane Plumbing Co',
        bio: 'Two decades of pipes',
        verified: true,
        member_since: '2022-01-01T00:00:00Z',
        jobs_completed: 17,
        service_categories: [{ id: 'c1', name: 'Plumbing' }],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof usePublicProviderProfile>);

    render(createElement(ProviderProfilePage));
    expect(screen.getByRole('heading', { name: 'Jane Plumbing Co' })).toBeDefined();
    expect(screen.getByText('Service Categories')).toBeDefined();
    expect(screen.getByText('No reviews yet.')).toBeDefined();
  });
});
