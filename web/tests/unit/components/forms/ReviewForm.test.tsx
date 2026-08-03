import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    getPublic: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

const mutateMock = vi.fn();
const reviewState = { mutate: mutateMock, isPending: false, isError: false };
vi.mock('@/hooks/useReviews', () => ({
  useCreateReview: () => reviewState,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const { ReviewForm } = await import('@/components/forms/ReviewForm');

// 14 days from now (well in the future)
const FUTURE_CLOSES_AT = new Date(Date.now() + 14 * 86_400_000).toISOString();

describe('ReviewForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutateMock.mockReset();
    reviewState.isPending = false;
    reviewState.isError = false;
  });

  it('renders the heading, comment textarea, and submit button', () => {
    const onSuccess = vi.fn();
    render(
      createElement(ReviewForm, {
        contractId: 'contract-1',
        direction: 'customer_to_provider',
        reviewWindowClosesAt: FUTURE_CLOSES_AT,
        onSuccess,
      }),
    );

    expect(screen.getByText('Leave a Review')).toBeDefined();
    expect(screen.getByPlaceholderText(/Share your experience/)).toBeDefined();
    expect(screen.getByRole('button', { name: /Submit Review/ })).toBeDefined();
  });

  it('renders customer→provider category labels when direction is customer_to_provider', () => {
    const onSuccess = vi.fn();
    render(
      createElement(ReviewForm, {
        contractId: 'contract-1',
        direction: 'customer_to_provider',
        reviewWindowClosesAt: FUTURE_CLOSES_AT,
        onSuccess,
      }),
    );

    // FR-6.2 customer→provider labels (fixed wire fields underneath).
    expect(screen.getByText('Quality of work')).toBeDefined();
    expect(screen.getByText('Communication')).toBeDefined();
    expect(screen.getByText('Timeliness')).toBeDefined();
    expect(screen.getByText('Value')).toBeDefined();
  });

  it('renders provider→customer persona labels on the same fixed wire fields', () => {
    const onSuccess = vi.fn();
    render(
      createElement(ReviewForm, {
        contractId: 'contract-1',
        direction: 'provider_to_customer',
        reviewWindowClosesAt: FUTURE_CLOSES_AT,
        onSuccess,
      }),
    );

    // FR-6.2 residual: API still uses quality/communication/timeliness/value keys.
    expect(screen.getByText('Payment promptness')).toBeDefined();
    expect(screen.getByText('Communication')).toBeDefined();
    expect(screen.getByText('Accuracy of scope')).toBeDefined();
    expect(screen.getByText('Property access')).toBeDefined();
    expect(screen.queryByText('Quality of work')).toBeNull();
    expect(screen.queryByText('Timeliness')).toBeNull();
    expect(screen.queryByText('Value')).toBeNull();
  });

  it('shows a validation error when overall rating is missing', async () => {
    const onSuccess = vi.fn();
    const { container } = render(
      createElement(ReviewForm, {
        contractId: 'contract-1',
        direction: 'provider_to_customer',
        reviewWindowClosesAt: FUTURE_CLOSES_AT,
        onSuccess,
      }),
    );

    const user = userEvent.setup();
    const comment = screen.getByPlaceholderText(/Share your experience/);
    await user.type(
      comment,
      'A long-enough review comment that satisfies the fifty character minimum requirement easily.',
    );

    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    if (form) fireEvent.submit(form);

    // Zod refuses overallRating=0 (min 1) — the form should not submit.
    await waitFor(() => {
      expect(mutateMock).not.toHaveBeenCalled();
    });
  });

  it('adds and removes a photo URL via the local-state controls', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    render(
      createElement(ReviewForm, {
        contractId: 'contract-1',
        direction: 'customer_to_provider',
        reviewWindowClosesAt: FUTURE_CLOSES_AT,
        onSuccess,
      }),
    );

    const photoInput = screen.getByPlaceholderText('https://example.com/photo.jpg');
    await user.type(photoInput, 'https://cdn.example.com/photo-1.jpg');
    await user.click(screen.getByRole('button', { name: /^Add$/ }));

    expect(screen.getByText('https://cdn.example.com/photo-1.jpg')).toBeDefined();

    await user.click(screen.getByRole('button', { name: /Remove photo URL/ }));
    expect(screen.queryByText('https://cdn.example.com/photo-1.jpg')).toBeNull();
  });

  it('calls createReview.mutate with the correct payload on a valid submission', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const { container } = render(
      createElement(ReviewForm, {
        contractId: 'contract-42',
        direction: 'provider_to_customer',
        reviewWindowClosesAt: FUTURE_CLOSES_AT,
        onSuccess,
      }),
    );

    // Click the 5th star in the overall radiogroup.
    const overallGroup = screen.getByRole('radiogroup', { name: /Overall rating/ });
    const fiveStarBtn = overallGroup.querySelectorAll('button[role="radio"]')[4];
    expect(fiveStarBtn).toBeDefined();
    if (fiveStarBtn) await user.click(fiveStarBtn);

    const comment = screen.getByPlaceholderText(/Share your experience/);
    await user.type(
      comment,
      'A long-enough review comment that satisfies the fifty character minimum requirement easily.',
    );

    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    if (form) fireEvent.submit(form);

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledTimes(1);
    });

    const calls = mutateMock.mock.calls as unknown[][];
    const firstCall = calls[0] ?? [];
    const args = firstCall[0] as { contractId: string; input: { overall_rating: number; comment: string } };
    expect(args.contractId).toBe('contract-42');
    expect(args.input.overall_rating).toBe(5);
    expect(args.input.comment.length).toBeGreaterThanOrEqual(50);
  });

  it('renders singular "1 day remaining" when exactly one day is left', () => {
    const onSuccess = vi.fn();
    // ~30 hours from now → ceil → 2 days. Use ~12h for ceil → 1 day.
    const closesIn1Day = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    render(
      createElement(ReviewForm, {
        contractId: 'contract-1',
        direction: 'customer_to_provider',
        reviewWindowClosesAt: closesIn1Day,
        onSuccess,
      }),
    );
    expect(screen.getByText(/1 day remaining/)).toBeDefined();
    // Confirm there is no plural "1 days" leakage.
    expect(screen.queryByText(/1 days remaining/)).toBeNull();
  });

  it('hides the days-remaining notice when the window has already closed', () => {
    const onSuccess = vi.fn();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    render(
      createElement(ReviewForm, {
        contractId: 'contract-1',
        direction: 'customer_to_provider',
        reviewWindowClosesAt: past,
        onSuccess,
      }),
    );
    expect(screen.queryByText(/remaining to submit your review/)).toBeNull();
  });

  it('disables the submit button and renders a spinner while createReview is pending', () => {
    reviewState.isPending = true;
    const onSuccess = vi.fn();
    render(
      createElement(ReviewForm, {
        contractId: 'contract-1',
        direction: 'customer_to_provider',
        reviewWindowClosesAt: FUTURE_CLOSES_AT,
        onSuccess,
      }),
    );
    const submitBtn = screen.getByRole('button', { name: /Submit Review/ });
    if (!(submitBtn instanceof HTMLButtonElement)) throw new Error('expected button element');
    expect(submitBtn.disabled).toBe(true);
    // Loader2 spinner has the animate-spin class.
    expect(submitBtn.querySelector('.animate-spin')).not.toBeNull();
  });

  it('renders an error message when createReview.isError is true', () => {
    reviewState.isError = true;
    const onSuccess = vi.fn();
    render(
      createElement(ReviewForm, {
        contractId: 'contract-1',
        direction: 'customer_to_provider',
        reviewWindowClosesAt: FUTURE_CLOSES_AT,
        onSuccess,
      }),
    );
    expect(screen.getByText(/Failed to submit review/)).toBeDefined();
  });

  it('does not add a duplicate photo URL', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    render(
      createElement(ReviewForm, {
        contractId: 'contract-1',
        direction: 'customer_to_provider',
        reviewWindowClosesAt: FUTURE_CLOSES_AT,
        onSuccess,
      }),
    );
    const photoInput = screen.getByPlaceholderText('https://example.com/photo.jpg');
    await user.type(photoInput, 'https://cdn.example.com/dup.jpg');
    await user.click(screen.getByRole('button', { name: /^Add$/ }));
    // Adding the same URL again should be a no-op.
    await user.type(photoInput, 'https://cdn.example.com/dup.jpg');
    await user.click(screen.getByRole('button', { name: /^Add$/ }));
    // Only ONE matching URL row.
    expect(screen.getAllByText('https://cdn.example.com/dup.jpg').length).toBe(1);
  });

  it('does not add an empty/whitespace-only photo URL', () => {
    const onSuccess = vi.fn();
    render(
      createElement(ReviewForm, {
        contractId: 'contract-1',
        direction: 'customer_to_provider',
        reviewWindowClosesAt: FUTURE_CLOSES_AT,
        onSuccess,
      }),
    );
    const addBtn = screen.getByRole('button', { name: /^Add$/ });
    // disabled while empty — the call should be a no-op.
    if (!(addBtn instanceof HTMLButtonElement)) throw new Error('expected button element');
    expect(addBtn.disabled).toBe(true);
  });
});
