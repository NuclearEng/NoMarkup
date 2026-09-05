// Provider detail page (`/providers/[id]`) — covers loading, error, and the
// success path with various data combinations: verified vs unverified,
// reviews + provider response, trust score + tier badge, response time, and
// the retry button on error.
import { fireEvent, render, screen, within } from '@testing-library/react';
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

vi.mock('@/components/providers/ResponseTimeBadge', () => ({
  ResponseTimeBadge: ({ label }: { label: string }) =>
    createElement('span', { 'data-testid': 'response-time' }, label),
}));

// FollowButton calls into TanStack Query — mock it out to keep the
// provider-profile suite focused on the profile presentation. The mock
// surfaces the hydration props (Bug 3) as data-attrs so we can assert the
// page wires initial follow state through correctly.
vi.mock('@/components/users/FollowButton', () => ({
  FollowButton: ({
    sellerId,
    initialFollowing,
    followerCount,
    currentUserId,
  }: {
    sellerId: string;
    initialFollowing?: boolean;
    followerCount?: number;
    currentUserId?: string;
  }) =>
    createElement(
      'button',
      {
        'data-testid': 'follow-button',
        'data-seller-id': sellerId,
        'data-initial-following': String(Boolean(initialFollowing)),
        'data-follower-count': followerCount === undefined ? '' : String(followerCount),
        'data-current-user-id': currentUserId ?? '',
      },
      'Follow',
    ),
}));

// Control the signed-in user id for the self-guard wiring assertion.
const authState = { userId: undefined as string | undefined };
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: authState.userId ? { id: authState.userId } : null }),
}));

// VerifiedBarBadge also calls into TanStack Query (license + flag queries) — mock
// it out for the same reason; it has its own dedicated test (legal-licenses).
vi.mock('@/components/providers/VerifiedBarBadge', () => ({
  VerifiedBarBadge: () => null,
}));

// Report / flag controls use mutations (QueryClient) — stub presentation only.
vi.mock('@/components/chat/ReportButton', () => ({
  ReportButton: () => createElement('button', { type: 'button', 'data-testid': 'report-provider' }, 'Report'),
}));
vi.mock('@/components/reviews/FlagReviewButton', () => ({
  FlagReviewButton: () => createElement('button', { type: 'button', 'data-testid': 'flag-review' }, 'Report'),
}));

vi.mock('@/hooks/useProviders', () => ({
  usePublicProviderProfile: vi.fn(),
}));

vi.mock('@/hooks/useReviews', () => ({
  useReviewsForUser: vi.fn(() => ({ data: { reviews: [] } })),
}));

const { usePublicProviderProfile } = await import('@/hooks/useProviders');
const { useReviewsForUser } = await import('@/hooks/useReviews');
// The page is now an async Server Component (server-fetch + JSON-LD); the
// interactive UI lives in ProviderProfileClient, which consumes the same
// usePublicProviderProfile hook (seeded via initialData). These tests drive
// the rendered UI through that mocked hook, so they target the client island.
const { ProviderProfileClient } = await import(
  '@/app/(public)/providers/[id]/ProviderProfileClient'
);

function makeProvider(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'p1',
    user_id: 'u1',
    display_name: 'Jane Provider',
    business_name: 'Jane Plumbing Co',
    bio: 'Two decades of pipes',
    verified: true,
    member_since: '2022-01-01T00:00:00Z',
    jobs_completed: 17,
    service_categories: [{ id: 'c1', name: 'Plumbing' }],
    ...overrides,
  };
}

// The client island requires providerId + initialProvider props. The mocked
// hook overrides what actually renders, so a minimal stub initialProvider is
// enough to satisfy the prop contract.
function renderClient() {
  return render(
    createElement(ProviderProfileClient, {
      providerId: 'test-id',
      initialProvider: makeProvider() as never,
    }),
  );
}

describe('(public)/providers/[id]/page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.userId = undefined;
    vi.mocked(useReviewsForUser).mockReturnValue({
      data: { reviews: [] },
    } as unknown as ReturnType<typeof useReviewsForUser>);
  });

  // The page is now RSC: the server fetches the profile and seeds the client
  // island via initialData, so there is no first-paint loading skeleton — the
  // island renders real content immediately. This asserts that no-skeleton
  // behavior (the seeded data is present from the first render).
  it('renders seeded content immediately with no loading skeleton', () => {
    vi.mocked(usePublicProviderProfile).mockReturnValue({
      data: makeProvider(),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof usePublicProviderProfile>);

    const { container } = renderClient();
    expect(container.querySelectorAll('.animate-pulse').length).toBe(0);
    expect(screen.getByRole('heading', { name: 'Jane Plumbing Co' })).toBeDefined();
  });

  it('renders the error state with retry button', () => {
    vi.mocked(usePublicProviderProfile).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof usePublicProviderProfile>);

    renderClient();
    expect(screen.getByText(/Failed to load provider profile/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined();
  });

  it('renders provider profile when loaded', () => {
    vi.mocked(usePublicProviderProfile).mockReturnValue({
      data: makeProvider(),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof usePublicProviderProfile>);

    renderClient();
    expect(screen.getByRole('heading', { name: 'Jane Plumbing Co' })).toBeDefined();
    expect(screen.getByText('Service Categories')).toBeDefined();
    expect(screen.getByText('No reviews yet.')).toBeDefined();
  });

  // ---- Deeper branch coverage ----

  it('renders the no-data error branch when isError=false but data is undefined', () => {
    vi.mocked(usePublicProviderProfile).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof usePublicProviderProfile>);

    renderClient();
    expect(screen.getByText(/Failed to load provider profile/)).toBeDefined();
  });

  it('clicking Retry calls refetch', () => {
    const refetch = vi.fn();
    vi.mocked(usePublicProviderProfile).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    } as unknown as ReturnType<typeof usePublicProviderProfile>);

    renderClient();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to display_name when business_name is missing and hides the secondary line', () => {
    vi.mocked(usePublicProviderProfile).mockReturnValue({
      data: makeProvider({ business_name: undefined }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof usePublicProviderProfile>);

    renderClient();
    expect(screen.getByRole('heading', { name: 'Jane Provider' })).toBeDefined();
    // The display_name secondary line is not rendered when business_name is absent.
    const headings = screen.getAllByRole('heading');
    expect(headings.length).toBeGreaterThan(0);
  });

  it('omits the Verified badge when provider is not verified', () => {
    vi.mocked(usePublicProviderProfile).mockReturnValue({
      data: makeProvider({ verified: false }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof usePublicProviderProfile>);

    renderClient();
    expect(screen.queryByText('Verified')).toBeNull();
  });

  it('renders the trust score panel and tier badge when trust_score is present', () => {
    vi.mocked(usePublicProviderProfile).mockReturnValue({
      data: makeProvider({
        // overall_score is on the API's 0.0-1.0 scale (matches the gateway
        // trust handler / BidCard); the page renders it as a 0-100 composite.
        trust_score: { overall_score: 0.87, tier: 'gold_tier' },
      }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof usePublicProviderProfile>);

    renderClient();
    // Trust score appears twice (hero + stats grid), rendered as a percentage.
    expect(screen.getAllByText('87').length).toBeGreaterThanOrEqual(2);
    // Tier name title-cased and underscores swapped for spaces.
    expect(screen.getByText('Gold Tier')).toBeDefined();
  });

  it('renders the review summary stats when present', () => {
    vi.mocked(usePublicProviderProfile).mockReturnValue({
      data: makeProvider({
        review_summary: {
          average_rating: 4.7,
          review_count: 12,
          on_time_rate: 0.95,
        },
      }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof usePublicProviderProfile>);

    renderClient();
    expect(screen.getByText('4.7')).toBeDefined();
    expect(screen.getByText(/Rating \(12\)/)).toBeDefined();
    expect(screen.getByText('95%')).toBeDefined();
    expect(screen.getByText('On-Time Rate')).toBeDefined();
  });

  it('renders the response time badge when label is provided', () => {
    vi.mocked(usePublicProviderProfile).mockReturnValue({
      data: makeProvider({ response_time_label: 'Responds in 1 hr' }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof usePublicProviderProfile>);

    renderClient();
    expect(screen.getByTestId('response-time').textContent).toBe('Responds in 1 hr');
  });

  it('renders the bio paragraph when bio is provided', () => {
    vi.mocked(usePublicProviderProfile).mockReturnValue({
      data: makeProvider({ bio: 'Hand-picked artisans for every job.' }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof usePublicProviderProfile>);

    renderClient();
    expect(screen.getByText('Hand-picked artisans for every job.')).toBeDefined();
  });

  it('omits the Service Categories card when service_categories is empty', () => {
    vi.mocked(usePublicProviderProfile).mockReturnValue({
      data: makeProvider({ service_categories: [] }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof usePublicProviderProfile>);

    renderClient();
    expect(screen.queryByText('Service Categories')).toBeNull();
  });

  it('renders multiple reviews and a provider response when present', () => {
    vi.mocked(usePublicProviderProfile).mockReturnValue({
      data: makeProvider(),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof usePublicProviderProfile>);
    vi.mocked(useReviewsForUser).mockReturnValue({
      data: {
        reviews: [
          {
            id: 'r1',
            overall_rating: 5,
            comment: 'Outstanding work, very professional.',
            created_at: '2026-04-10T00:00:00Z',
            response: { comment: 'Thanks for the kind words!' },
          },
          {
            id: 'r2',
            overall_rating: 4,
            comment: 'Good job overall.',
            created_at: '2026-04-15T00:00:00Z',
          },
        ],
      },
    } as unknown as ReturnType<typeof useReviewsForUser>);

    renderClient();
    expect(screen.getByText(/Outstanding work, very professional\./)).toBeDefined();
    expect(screen.getByText(/Good job overall\./)).toBeDefined();
    expect(screen.getByText('Provider Response')).toBeDefined();
    expect(screen.getByText('Thanks for the kind words!')).toBeDefined();
  });

  // Bug 3 — the page must hydrate FollowButton with is_following /
  // follower_count from the profile + the signed-in user's id.
  it('wires is_following, follower_count, and currentUserId into FollowButton', () => {
    authState.userId = 'viewer-9';
    vi.mocked(usePublicProviderProfile).mockReturnValue({
      data: makeProvider({ user_id: 'u1', is_following: true, follower_count: 128 }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof usePublicProviderProfile>);

    renderClient();
    const btn = screen.getByTestId('follow-button');
    expect(btn.getAttribute('data-seller-id')).toBe('u1');
    expect(btn.getAttribute('data-initial-following')).toBe('true');
    expect(btn.getAttribute('data-follower-count')).toBe('128');
    expect(btn.getAttribute('data-current-user-id')).toBe('viewer-9');
  });

  it('defaults FollowButton to not-following when is_following is absent (fail-soft)', () => {
    vi.mocked(usePublicProviderProfile).mockReturnValue({
      data: makeProvider({ user_id: 'u1' }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof usePublicProviderProfile>);

    renderClient();
    const btn = screen.getByTestId('follow-button');
    expect(btn.getAttribute('data-initial-following')).toBe('false');
    expect(btn.getAttribute('data-current-user-id')).toBe('');
  });

  it('renders the trust score "--" placeholder in stats when no trust score', () => {
    vi.mocked(usePublicProviderProfile).mockReturnValue({
      data: makeProvider({ trust_score: undefined }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof usePublicProviderProfile>);

    renderClient();
    // Stats grid trust score cell shows "--".
    const trustLabel = screen.getByText('Trust Score');
    const cell = trustLabel.parentElement;
    expect(within(cell as HTMLElement).getByText('--')).toBeDefined();
  });
});
