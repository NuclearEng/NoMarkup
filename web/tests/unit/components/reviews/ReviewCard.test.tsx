import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Radix Select needs polyfills jsdom doesn't ship with.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver;
  Element.prototype.scrollIntoView = function scrollIntoView() {
    /* noop */
  };
  Element.prototype.hasPointerCapture = function hasPointerCapture() {
    return false;
  };
  Element.prototype.releasePointerCapture = function releasePointerCapture() {
    /* noop */
  };
});

import { ReviewCard } from '@/components/reviews/ReviewCard';
import type { Review } from '@/types';

const mockRespond = vi.fn();
const mockFlag = vi.fn();

const respondState = { isPending: false, isError: false };
const flagState = { isPending: false, isError: false };

vi.mock('@/hooks/useReviews', () => ({
  useRespondToReview: () => ({
    mutate: mockRespond,
    isPending: respondState.isPending,
    isError: respondState.isError,
  }),
  useFlagReview: () => ({
    mutate: mockFlag,
    isPending: flagState.isPending,
    isError: flagState.isError,
  }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: vi.fn(),
}));

const { useAuthStore } = await import('@/stores/auth-store');

function setUser(user: { id: string } | null) {
  vi.mocked(useAuthStore).mockImplementation(
    ((selector: (s: Record<string, unknown>) => unknown) =>
      selector({ user, isAuthenticated: !!user, token: null })) as unknown as typeof useAuthStore,
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
    respondState.isPending = false;
    respondState.isError = false;
    flagState.isPending = false;
    flagState.isError = false;
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
    expect(screen.getByText('Quality of work')).toBeDefined();
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

  it('submits a response when text is valid and Submit is clicked', async () => {
    setUser({ id: 'reviewee-87654321' });
    const user = userEvent.setup();
    render(createElement(ReviewCard, { review: makeReview() }));
    await user.click(screen.getByRole('button', { name: /respond/i }));
    const textarea = screen.getByPlaceholderText(/Write your response/i);
    await user.type(textarea, 'Thanks for the kind feedback!');
    await user.click(screen.getByRole('button', { name: /submit response/i }));
    expect(mockRespond).toHaveBeenCalledTimes(1);
    const args = mockRespond.mock.calls[0]?.[0] as { reviewId: string; comment: string };
    expect(args.reviewId).toBe('r-1');
    expect(args.comment).toBe('Thanks for the kind feedback!');
  });

  it('shows validation error when response is too short', async () => {
    setUser({ id: 'reviewee-87654321' });
    const user = userEvent.setup();
    render(createElement(ReviewCard, { review: makeReview() }));
    await user.click(screen.getByRole('button', { name: /respond/i }));
    const textarea = screen.getByPlaceholderText(/Write your response/i);
    await user.type(textarea, 'short');
    await user.click(screen.getByRole('button', { name: /submit response/i }));
    expect(mockRespond).not.toHaveBeenCalled();
    expect(screen.getByText(/at least 10 characters/i)).toBeDefined();
  });

  it('clears the validation error when the user types again', async () => {
    setUser({ id: 'reviewee-87654321' });
    const user = userEvent.setup();
    render(createElement(ReviewCard, { review: makeReview() }));
    await user.click(screen.getByRole('button', { name: /respond/i }));
    const textarea = screen.getByPlaceholderText(/Write your response/i);
    await user.type(textarea, 'short');
    await user.click(screen.getByRole('button', { name: /submit response/i }));
    expect(screen.getByText(/at least 10 characters/i)).toBeDefined();
    await user.type(textarea, ' more text');
    expect(screen.queryByText(/at least 10 characters/i)).toBeNull();
  });

  it('hides the response form when Cancel is clicked', async () => {
    setUser({ id: 'reviewee-87654321' });
    const user = userEvent.setup();
    render(createElement(ReviewCard, { review: makeReview() }));
    await user.click(screen.getByRole('button', { name: /respond/i }));
    expect(screen.getByPlaceholderText(/Write your response/i)).toBeDefined();
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByPlaceholderText(/Write your response/i)).toBeNull();
  });

  it('opens the flag form when Report is clicked', async () => {
    setUser({ id: 'someone-else' });
    const user = userEvent.setup();
    render(createElement(ReviewCard, { review: makeReview() }));
    await user.click(screen.getByRole('button', { name: /report/i }));
    expect(screen.getByText(/Select reason for flagging/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /flag/i })).toBeDefined();
  });

  it('closes the flag form when Cancel is clicked', async () => {
    setUser({ id: 'someone-else' });
    const user = userEvent.setup();
    render(createElement(ReviewCard, { review: makeReview() }));
    await user.click(screen.getByRole('button', { name: /report/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByText(/Select reason for flagging/i)).toBeNull();
    expect(screen.getByRole('button', { name: /report/i })).toBeDefined();
  });

  it('disables the Flag button when no reason is selected', async () => {
    setUser({ id: 'someone-else' });
    const user = userEvent.setup();
    render(createElement(ReviewCard, { review: makeReview() }));
    await user.click(screen.getByRole('button', { name: /report/i }));
    const flagButton = screen.getByRole('button', { name: /flag/i });
    expect(flagButton.hasAttribute('disabled')).toBe(true);
    // Clicking the disabled flag button must not trigger the mutation
    await user.click(flagButton);
    expect(mockFlag).not.toHaveBeenCalled();
  });

  it('renders photo url links when present', () => {
    setUser(null);
    render(
      createElement(ReviewCard, {
        review: makeReview({ photo_urls: ['https://cdn.example.com/photos/abc.jpg'] }),
      }),
    );
    const link = screen.getByRole('link', { name: 'abc.jpg' });
    expect(link.getAttribute('href')).toBe('https://cdn.example.com/photos/abc.jpg');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('hides Respond button when reviewee already responded', () => {
    setUser({ id: 'reviewee-87654321' });
    render(
      createElement(ReviewCard, {
        review: makeReview({
          response: {
            id: 'rr-1',
            review_id: 'r-1',
            responder_id: 'reviewee-87654321',
            comment: 'Already responded.',
            created_at: new Date().toISOString(),
          },
        }),
      }),
    );
    expect(screen.queryByRole('button', { name: /respond/i })).toBeNull();
  });

  it('hides Report button for the reviewer themselves', () => {
    setUser({ id: 'reviewer-12345678' });
    render(createElement(ReviewCard, { review: makeReview() }));
    expect(screen.queryByRole('button', { name: /report/i })).toBeNull();
  });

  it('hides Report button when review is already flagged', () => {
    setUser({ id: 'someone-else' });
    render(createElement(ReviewCard, { review: makeReview({ is_flagged: true }) }));
    expect(screen.queryByRole('button', { name: /report/i })).toBeNull();
  });

  it('renders provider-to-customer direction label', () => {
    setUser(null);
    render(
      createElement(ReviewCard, {
        review: makeReview({ direction: 'provider_to_customer' }),
      }),
    );
    expect(screen.getByText('Provider to Customer')).toBeDefined();
  });

  it('shows error message when response submission fails', async () => {
    respondState.isError = true;
    setUser({ id: 'reviewee-87654321' });
    const user = userEvent.setup();
    render(createElement(ReviewCard, { review: makeReview() }));
    await user.click(screen.getByRole('button', { name: /respond/i }));
    // Once the form is open, the error block is rendered (line 220-224)
    expect(screen.getByText(/Failed to submit response/i)).toBeDefined();
  });

  it('disables the Cancel button while response mutation is pending', async () => {
    respondState.isPending = true;
    setUser({ id: 'reviewee-87654321' });
    const user = userEvent.setup();
    render(createElement(ReviewCard, { review: makeReview() }));
    await user.click(screen.getByRole('button', { name: /respond/i }));
    const submit = screen.getByRole('button', { name: /submit response/i });
    expect(submit.hasAttribute('disabled')).toBe(true);
    const cancel = screen.getByRole('button', { name: /cancel/i });
    expect(cancel.hasAttribute('disabled')).toBe(true);
  });

  it('shows pending spinner on Flag button while flag mutation is pending', async () => {
    flagState.isPending = true;
    setUser({ id: 'someone-else' });
    const user = userEvent.setup();
    const { container } = render(createElement(ReviewCard, { review: makeReview() }));
    await user.click(screen.getByRole('button', { name: /report/i }));
    // Loader2 spinner present inside the Flag button (line 261-263)
    const spinner = container.querySelector('button .animate-spin');
    expect(spinner).not.toBeNull();
    // Cancel is disabled during pending too
    const cancel = screen.getByRole('button', { name: /cancel/i });
    expect(cancel.hasAttribute('disabled')).toBe(true);
  });

  it('shows error message when flag submission fails', async () => {
    flagState.isError = true;
    setUser({ id: 'someone-else' });
    const user = userEvent.setup();
    render(createElement(ReviewCard, { review: makeReview() }));
    await user.click(screen.getByRole('button', { name: /report/i }));
    expect(screen.getByText(/Failed to flag review/i)).toBeDefined();
  });

  it('shows pending spinner on Submit Response while pending', async () => {
    setUser({ id: 'reviewee-87654321' });
    const user = userEvent.setup();
    // First render with default (not pending) so we can open the form
    const { rerender, container } = render(
      createElement(ReviewCard, { review: makeReview() }),
    );
    await user.click(screen.getByRole('button', { name: /respond/i }));
    // Then flip pending and rerender to exercise the spinner branch
    respondState.isPending = true;
    rerender(createElement(ReviewCard, { review: makeReview() }));
    const spinner = container.querySelector('button .animate-spin');
    expect(spinner).not.toBeNull();
  });

  it('invokes onSuccess and closes the response form after a successful submit', async () => {
    // Make the respond mutation invoke the onSuccess callback synchronously
    mockRespond.mockImplementation((
      _vars: { reviewId: string; comment: string },
      opts: { onSuccess?: () => void },
    ) => {
      opts.onSuccess?.();
    });
    setUser({ id: 'reviewee-87654321' });
    const user = userEvent.setup();
    render(createElement(ReviewCard, { review: makeReview() }));
    await user.click(screen.getByRole('button', { name: /respond/i }));
    const textarea = screen.getByPlaceholderText(/Write your response/i);
    await user.type(textarea, 'A genuinely thoughtful response.');
    await user.click(screen.getByRole('button', { name: /submit response/i }));
    // Form should be hidden after onSuccess collapses showResponseForm
    expect(screen.queryByPlaceholderText(/Write your response/i)).toBeNull();
    // And the Respond trigger should be visible again
    expect(screen.getByRole('button', { name: /respond/i })).toBeDefined();
  });

  it('invokes onSuccess and closes the flag form after a successful flag', async () => {
    mockFlag.mockImplementation((
      _vars: { reviewId: string; reason: string },
      opts: { onSuccess?: () => void },
    ) => {
      opts.onSuccess?.();
    });
    setUser({ id: 'someone-else' });
    const user = userEvent.setup();
    render(createElement(ReviewCard, { review: makeReview() }));
    await user.click(screen.getByRole('button', { name: /report/i }));
    // Manually set a flag reason via the radix-driven state through pointer events
    // is complex; instead, use the test-only path: the disabled button doesn't
    // submit. To exercise onSuccess we must have a non-empty flagReason. The
    // simplest path is to find the trigger and use keyboard interaction.
    // Use radix Select keyboard nav: focus trigger, press space to open, then
    // arrow + enter.
    const trigger = screen.getByRole('combobox');
    trigger.focus();
    await user.keyboard('{Enter}');
    // Wait for menu, then pick first item (Inappropriate)
    const item = await screen.findByText('Inappropriate');
    await user.click(item);
    // Now click the Flag button
    await user.click(screen.getByRole('button', { name: /^flag$/i }));
    // After onSuccess fires, the flag form should be hidden and Report visible
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('button', { name: /report/i })).toBeDefined();
  });

  it('renders only specific sub-ratings when only some are present', () => {
    setUser(null);
    // Only quality_rating present — exercises the falsy branch for the other sub-ratings
    render(
      createElement(ReviewCard, {
        review: makeReview({ quality_rating: 5 }),
      }),
    );
    expect(screen.getByText('Quality of work')).toBeDefined();
    expect(screen.queryByText('Communication')).toBeNull();
    expect(screen.queryByText('Timeliness')).toBeNull();
    expect(screen.queryByText('Value')).toBeNull();
  });
  it('labels sub-ratings with provider→customer real fields (FR-6.2)', () => {
    setUser(null);
    render(
      createElement(ReviewCard, {
        review: makeReview({
          direction: 'provider_to_customer',
          payment_promptness_rating: 5,
          scope_accuracy_rating: 3,
          access_rating: 2,
          // Customer dims present must not show under provider direction.
          quality_rating: 5,
          value_rating: 2,
        }),
      }),
    );
    expect(screen.getByText('Payment promptness')).toBeDefined();
    expect(screen.getByText('Accuracy of scope')).toBeDefined();
    expect(screen.getByText('Property access')).toBeDefined();
    expect(screen.queryByText('Quality of work')).toBeNull();
    expect(screen.queryByText(/^Quality$/)).toBeNull();
    expect(screen.queryByText('Timeliness')).toBeNull();
  });

});
