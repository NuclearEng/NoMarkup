import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReviewCard } from '@/components/reviews/ReviewCard';
import type { Review } from '@/types';

const mockRespond = vi.fn();
const mockFlag = vi.fn();

vi.mock('@/hooks/useReviews', () => ({
  useRespondToReview: () => ({ mutate: mockRespond, isPending: false, isError: false }),
  useFlagReview: () => ({ mutate: mockFlag, isPending: false, isError: false }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: vi.fn(),
}));

const { useAuthStore } = await import('@/stores/auth-store');

function setUser(user: { id: string } | null) {
  vi.mocked(useAuthStore).mockImplementation(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({ user, isAuthenticated: !!user, token: null }),
  );
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    id: 'r-1',
    contract_id: 'c-1',
    reviewer_id: 'reviewer-12345678',
    reviewee_id: 'reviewee-87654321',
    direction: 'customer_to_provider',
    overall_rating: 5,
    comment: 'Outstanding service!',
    photo_urls: [],
    is_flagged: false,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('ReviewCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the review comment and direction label', () => {
    setUser(null);
    render(createElement(ReviewCard, { review: makeReview() }));
    expect(screen.getByText('Outstanding service!')).toBeDefined();
    expect(screen.getByText('Customer to Provider')).toBeDefined();
  });

  it('renders the overall rating with aria-label', () => {
    setUser(null);
    render(createElement(ReviewCard, { review: makeReview({ overall_rating: 4 }) }));
    expect(screen.getByLabelText('Rating: 4 out of 5 stars')).toBeDefined();
  });

  it('renders sub-ratings when present', () => {
    setUser(null);
    render(
      createElement(ReviewCard, {
        review: makeReview({
          quality_rating: 5,
          communication_rating: 4,
          timeliness_rating: 3,
          value_rating: 5,
        }),
      }),
    );
    expect(screen.getByText('Quality')).toBeDefined();
    expect(screen.getByText('Communication')).toBeDefined();
    expect(screen.getByText('Timeliness')).toBeDefined();
    expect(screen.getByText('Value')).toBeDefined();
  });

  it('shows a Respond button only for the reviewee', () => {
    setUser({ id: 'reviewee-87654321' });
    render(createElement(ReviewCard, { review: makeReview() }));
    expect(screen.getByRole('button', { name: /respond/i })).toBeDefined();
  });

  it('reveals response form when Respond is clicked', async () => {
    setUser({ id: 'reviewee-87654321' });
    const user = userEvent.setup();
    render(createElement(ReviewCard, { review: makeReview() }));
    await user.click(screen.getByRole('button', { name: /respond/i }));
    expect(screen.getByPlaceholderText(/Write your response/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /submit response/i })).toBeDefined();
  });

  it('shows existing response when present', () => {
    setUser(null);
    render(
      createElement(ReviewCard, {
        review: makeReview({
          response: {
            id: 'rr-1',
            review_id: 'r-1',
            responder_id: 'reviewee-87654321',
            comment: 'Thank you!',
            created_at: new Date().toISOString(),
          },
        }),
      }),
    );
    expect(screen.getByText('Thank you!')).toBeDefined();
  });

  it('shows flagged badge when review is flagged', () => {
    setUser(null);
    render(createElement(ReviewCard, { review: makeReview({ is_flagged: true }) }));
    expect(screen.getByText('Flagged')).toBeDefined();
  });

  it('shows a Report button for users that are not the reviewer', () => {
    setUser({ id: 'someone-else' });
    render(createElement(ReviewCard, { review: makeReview() }));
    expect(screen.getByRole('button', { name: /report/i })).toBeDefined();
  });
});
