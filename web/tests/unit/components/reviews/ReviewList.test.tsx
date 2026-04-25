import { render, screen } from '@testing-library/react';
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
});
