import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReviewList } from '@/components/reviews/ReviewList';
import type { Review } from '@/types';

vi.mock('@/hooks/useReviews', () => ({
  useReviewsForUser: vi.fn(),
  useRespondToReview: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useFlagReview: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ user: null, isAuthenticated: false, token: null }),
}));

const { useReviewsForUser } = await import('@/hooks/useReviews');

function makeReview(id: string): Review {
  return {
    id,
    contract_id: 'c-1',
    reviewer_id: 'reviewer-12345678',
    reviewee_id: 'reviewee-87654321',
    direction: 'customer_to_provider',
    overall_rating: 5,
    comment: `Comment ${id}`,
    photo_urls: [],
    is_flagged: false,
    created_at: new Date().toISOString(),
  };
}

function mockResult(value: ReturnType<typeof useReviewsForUser>) {
  vi.mocked(useReviewsForUser).mockReturnValue(value);
}

describe('ReviewList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading spinner while fetching', () => {
    mockResult({ data: undefined, isLoading: true, isError: false } as unknown as ReturnType<
      typeof useReviewsForUser
    >);
    const { container } = render(createElement(ReviewList, { userId: 'u-1' }));
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  it('shows error message on fetch error', () => {
    mockResult({ data: undefined, isLoading: false, isError: true } as unknown as ReturnType<
      typeof useReviewsForUser
    >);
    render(createElement(ReviewList, { userId: 'u-1' }));
    expect(screen.getByText(/Failed to load reviews/i)).toBeDefined();
  });

  it('shows empty state when there are no reviews', () => {
    mockResult({
      data: {
        reviews: [],
        average_rating: 0,
        total_reviews: 0,
        pagination: { page: 1, perPage: 10, totalCount: 0, totalPages: 0, hasNext: false },
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useReviewsForUser>);
    render(createElement(ReviewList, { userId: 'u-1' }));
    expect(screen.getByText(/No reviews yet/i)).toBeDefined();
  });

  it('renders the list of reviews and total count', () => {
    mockResult({
      data: {
        reviews: [makeReview('r-1'), makeReview('r-2')],
        average_rating: 4.5,
        total_reviews: 2,
        pagination: { page: 1, perPage: 10, totalCount: 2, totalPages: 1, hasNext: false },
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useReviewsForUser>);
    render(createElement(ReviewList, { userId: 'u-1' }));

    expect(screen.getByText('2 reviews')).toBeDefined();
    expect(screen.getByText('Comment r-1')).toBeDefined();
    expect(screen.getByText('Comment r-2')).toBeDefined();
  });

  it('uses singular "review" for a count of one', () => {
    mockResult({
      data: {
        reviews: [makeReview('r-only')],
        average_rating: 5,
        total_reviews: 1,
        pagination: { page: 1, perPage: 10, totalCount: 1, totalPages: 1, hasNext: false },
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useReviewsForUser>);
    render(createElement(ReviewList, { userId: 'u-1' }));
    expect(screen.getByText('1 review')).toBeDefined();
  });

  it('switches direction filter and resets page when From Customers tab is clicked', async () => {
    mockResult({
      data: {
        reviews: [makeReview('r-1')],
        average_rating: 4.5,
        total_reviews: 1,
        pagination: { page: 1, perPage: 10, totalCount: 1, totalPages: 1, hasNext: false },
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useReviewsForUser>);
    const user = userEvent.setup();
    render(createElement(ReviewList, { userId: 'u-42' }));
    await user.click(screen.getByRole('tab', { name: /From Customers/i }));
    // The hook should be re-invoked with the customer_to_provider direction filter
    const lastCall = vi.mocked(useReviewsForUser).mock.calls.at(-1);
    expect(lastCall?.[0]).toBe('u-42');
    expect(lastCall?.[1]).toMatchObject({
      direction: 'customer_to_provider',
      page: 1,
      per_page: 10,
    });
  });

  it('passes provider_to_customer direction when From Providers tab is selected', async () => {
    mockResult({
      data: {
        reviews: [],
        average_rating: 0,
        total_reviews: 0,
        pagination: { page: 1, perPage: 10, totalCount: 0, totalPages: 0, hasNext: false },
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useReviewsForUser>);
    const user = userEvent.setup();
    render(createElement(ReviewList, { userId: 'u-1' }));
    await user.click(screen.getByRole('tab', { name: /From Providers/i }));
    const lastCall = vi.mocked(useReviewsForUser).mock.calls.at(-1);
    expect(lastCall?.[1]).toMatchObject({ direction: 'provider_to_customer' });
  });

  it('renders Previous/Next pagination controls when totalPages > 1', () => {
    mockResult({
      data: {
        reviews: [makeReview('r-1')],
        average_rating: 4.5,
        total_reviews: 25,
        pagination: { page: 1, perPage: 10, totalCount: 25, totalPages: 3, hasNext: true },
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useReviewsForUser>);
    render(createElement(ReviewList, { userId: 'u-1' }));
    expect(screen.getByRole('button', { name: /previous/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /next/i })).toBeDefined();
    expect(screen.getByText(/Page 1 of 3/i)).toBeDefined();
  });

  it('disables Previous on the first page', () => {
    mockResult({
      data: {
        reviews: [makeReview('r-1')],
        average_rating: 4.5,
        total_reviews: 25,
        pagination: { page: 1, perPage: 10, totalCount: 25, totalPages: 3, hasNext: true },
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useReviewsForUser>);
    render(createElement(ReviewList, { userId: 'u-1' }));
    const prev = screen.getByRole('button', { name: /previous/i });
    expect(prev.hasAttribute('disabled')).toBe(true);
  });

  it('advances the page when Next is clicked', async () => {
    mockResult({
      data: {
        reviews: [makeReview('r-1')],
        average_rating: 4.5,
        total_reviews: 25,
        pagination: { page: 1, perPage: 10, totalCount: 25, totalPages: 3, hasNext: true },
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useReviewsForUser>);
    const user = userEvent.setup();
    render(createElement(ReviewList, { userId: 'u-1' }));
    await user.click(screen.getByRole('button', { name: /next/i }));
    const lastCall = vi.mocked(useReviewsForUser).mock.calls.at(-1);
    expect(lastCall?.[1]).toMatchObject({ page: 2 });
  });

  it('does not render pagination when there is only one page', () => {
    mockResult({
      data: {
        reviews: [makeReview('r-1')],
        average_rating: 4.5,
        total_reviews: 1,
        pagination: { page: 1, perPage: 10, totalCount: 1, totalPages: 1, hasNext: false },
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useReviewsForUser>);
    render(createElement(ReviewList, { userId: 'u-1' }));
    expect(screen.queryByRole('button', { name: /previous/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /next/i })).toBeNull();
  });
});
