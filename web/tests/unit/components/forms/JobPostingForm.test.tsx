import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Tell React we're running in an act() environment so async wrappers behave.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Radix's Slider/Select use ResizeObserver + pointer-capture. jsdom does not
// implement either, so we stub them globally for this test file.
beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
      ResizeObserverStub;
  }
  // jsdom does not implement these — always stub.
  Element.prototype.hasPointerCapture = (): boolean => false;
  Element.prototype.releasePointerCapture = (): void => {
    // no-op
  };
  Element.prototype.scrollIntoView = (): void => {
    // no-op
  };
});

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/jobs/new',
  useSearchParams: () => new URLSearchParams(),
}));

const apiPostMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: (...args: unknown[]): Promise<unknown> => apiPostMock(...args),
    patch: vi.fn(),
    delete: vi.fn(),
    getPublic: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

const createJobMutateAsyncMock = vi.fn();
vi.mock('@/hooks/useJobs', () => ({
  useCreateJob: () => ({
    mutateAsync: createJobMutateAsyncMock,
    isPending: false,
    isError: false,
  }),
}));

vi.mock('@/hooks/useCategories', () => ({
  useCategories: () => ({ data: [], isLoading: false }),
  useCategoryTree: () => ({ data: [], isLoading: false }),
}));

// Mocked child components — they pull in their own data layer that we don't care
// about for this form's tests. CategorySelector exposes a stub button so we can
// drive the categoryId state without rendering real categories.
vi.mock('@/components/providers/CategorySelector', () => ({
  CategorySelector: ({ onChange }: { onChange: (ids: string[]) => void }) =>
    createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'mock-category-select',
        onClick: () => { onChange(['cat-1']); },
      },
      'Select Category',
    ),
}));

vi.mock('@/components/jobs/MarketRangeDisplay', () => ({
  MarketRangeDisplay: () => null,
}));

vi.mock('@/components/forms/ImageAnalysisButton', () => ({
  ImageAnalysisButton: () => null,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const { JobPostingForm } = await import('@/components/forms/JobPostingForm');

// Helper to advance from Category to Details step
async function advanceToStep(targetStep: number, user: ReturnType<typeof userEvent.setup>) {
  // Step 0 -> 1
  await user.click(screen.getByTestId('mock-category-select'));
  await user.click(screen.getByRole('button', { name: /Next/ }));
  if (targetStep === 1) return;

  // Step 1 -> 2 (Details)
  await waitFor(() => {
    expect(screen.getByText(/Step 2 of 7/)).toBeDefined();
  });
  await user.type(
    screen.getByPlaceholderText(/Kitchen sink repair/),
    'Need to fix a leaky faucet please',
  );
  await user.type(
    screen.getByPlaceholderText(/Describe the work you need done in detail/),
    'This is a long enough description to satisfy the minimum 50 character validation rule for sure now.',
  );
  await user.click(screen.getByRole('button', { name: /Next/ }));
  if (targetStep === 2) return;

  // Step 2 -> 3 (Location, no required fields)
  await waitFor(() => {
    expect(screen.getByText(/Step 3 of 7/)).toBeDefined();
  });
  await user.click(screen.getByRole('button', { name: /Next/ }));
  if (targetStep === 3) return;

  // Step 3 -> 4 (Schedule defaults to flexible, valid)
  await waitFor(() => {
    expect(screen.getByText(/Step 4 of 7/)).toBeDefined();
  });
  await user.click(screen.getByRole('button', { name: /Next/ }));
  if (targetStep === 4) return;

  // Step 4 -> 5 (Photos optional)
  await waitFor(() => {
    expect(screen.getByText(/Step 5 of 7/)).toBeDefined();
  });
  await user.click(screen.getByRole('button', { name: /Next/ }));
  if (targetStep === 5) return;

  // Step 5 -> 6 (Auction defaults valid)
  await waitFor(() => {
    expect(screen.getByText(/Step 6 of 7/)).toBeDefined();
  });
  await user.click(screen.getByRole('button', { name: /Next/ }));
  await waitFor(() => {
    expect(screen.getByText(/Step 7 of 7/)).toBeDefined();
  });
}

describe('JobPostingForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createJobMutateAsyncMock.mockReset();
    apiPostMock.mockReset();
    pushMock.mockReset();
  });

  it('renders the first step (Category) and the navigation Next button', () => {
    render(createElement(JobPostingForm));

    expect(screen.getByText('Post a New Job')).toBeDefined();
    expect(screen.getByText(/Step 1 of 7/)).toBeDefined();
    expect(screen.getByTestId('mock-category-select')).toBeDefined();
    expect(screen.getByRole('button', { name: /Next/ })).toBeDefined();
  });

  it('blocks advancing past the Category step until a category is selected', async () => {
    const user = userEvent.setup();
    render(createElement(JobPostingForm));

    await user.click(screen.getByRole('button', { name: /Next/ }));

    // Still on step 1 — error message visible.
    expect(await screen.findByText(/Category is required/)).toBeDefined();
    expect(screen.getByText(/Step 1 of 7/)).toBeDefined();
  });

  it('advances to the Details step after a category is selected', async () => {
    const user = userEvent.setup();
    render(createElement(JobPostingForm));

    await user.click(screen.getByTestId('mock-category-select'));
    await user.click(screen.getByRole('button', { name: /Next/ }));

    await waitFor(() => {
      expect(screen.getByText(/Step 2 of 7/)).toBeDefined();
    });
    expect(screen.getByPlaceholderText(/Kitchen sink repair/)).toBeDefined();
  });

  it('shows a validation error for a too-short title on the Details step', async () => {
    const user = userEvent.setup();
    render(createElement(JobPostingForm));

    await user.click(screen.getByTestId('mock-category-select'));
    await user.click(screen.getByRole('button', { name: /Next/ }));

    await waitFor(() => {
      expect(screen.getByText(/Step 2 of 7/)).toBeDefined();
    });

    await user.type(screen.getByPlaceholderText(/Kitchen sink repair/), 'short');
    await user.click(screen.getByRole('button', { name: /Next/ }));

    expect(await screen.findByText(/Title must be at least 10 characters/)).toBeDefined();
    // Still on step 2.
    expect(screen.getByText(/Step 2 of 7/)).toBeDefined();
  });

  it('lets the user step back to the previous step via the Previous button', async () => {
    const user = userEvent.setup();
    render(createElement(JobPostingForm));

    await user.click(screen.getByTestId('mock-category-select'));
    await user.click(screen.getByRole('button', { name: /Next/ }));

    await waitFor(() => {
      expect(screen.getByText(/Step 2 of 7/)).toBeDefined();
    });

    await user.click(screen.getByRole('button', { name: /Previous/ }));
    await waitFor(() => {
      expect(screen.getByText(/Step 1 of 7/)).toBeDefined();
    });
  });

  it('renders the step indicator nav with all seven steps', () => {
    render(createElement(JobPostingForm));

    const nav = screen.getByRole('navigation', { name: /Job posting steps/ });
    const stepButtons = nav.querySelectorAll('button');
    expect(stepButtons).toHaveLength(7);
  });

  // ---- DEEPENING TESTS ----

  it('shows the live character counter for the title input', async () => {
    const user = userEvent.setup();
    render(createElement(JobPostingForm));

    await advanceToStep(1, user);
    await waitFor(() => {
      expect(screen.getByText(/0\/200 characters/)).toBeDefined();
    });
    await user.type(screen.getByPlaceholderText(/Kitchen sink repair/), 'hello');
    expect(screen.getByText(/5\/200 characters/)).toBeDefined();
  });

  it('shows the live character counter for the description input', async () => {
    const user = userEvent.setup();
    render(createElement(JobPostingForm));

    await advanceToStep(1, user);
    await user.type(
      screen.getByPlaceholderText(/Describe the work you need done in detail/),
      'abcdef',
    );
    expect(screen.getByText(/6\/5000 characters/)).toBeDefined();
  });

  it('renders the Location step with the no-coords placeholder when no address entered', async () => {
    const user = userEvent.setup();
    render(createElement(JobPostingForm));

    await advanceToStep(2, user);
    expect(screen.getByText(/Map preview unavailable|Enter an address above/)).toBeDefined();
  });

  it('reveals the date input when scheduleType is specific_date', async () => {
    const user = userEvent.setup();
    render(createElement(JobPostingForm));

    await advanceToStep(3, user);

    // Open the schedule type select
    const trigger = screen.getByRole('combobox');
    await user.click(trigger);
    const specificOption = await screen.findByRole('option', { name: /Specific Date/ });
    await user.click(specificOption);

    await waitFor(() => {
      expect(screen.getByLabelText(/Preferred Date/)).toBeDefined();
    });
  });

  it('reveals the recurrence frequency dropdown when recurring is checked', async () => {
    const user = userEvent.setup();
    render(createElement(JobPostingForm));

    await advanceToStep(3, user);

    const recurring = screen.getByRole('checkbox', { name: /recurring/i });
    await user.click(recurring);

    await waitFor(() => {
      expect(screen.getByText(/Recurrence Frequency/)).toBeDefined();
    });
  });

  it('shows the photos step empty state with no photos selected', async () => {
    const user = userEvent.setup();
    render(createElement(JobPostingForm));

    await advanceToStep(4, user);

    expect(screen.getByText(/Drag photos here or click to browse/)).toBeDefined();
    expect(screen.getByText(/Up to 10 photos/)).toBeDefined();
  });

  it('renders the auction step with the duration label', async () => {
    const user = userEvent.setup();
    render(createElement(JobPostingForm));

    await advanceToStep(5, user);

    expect(screen.getByText(/Auction Duration:/)).toBeDefined();
    expect(screen.getByText(/Starting Bid \(optional\)/)).toBeDefined();
    expect(screen.getByText(/Instant Accept Price \(optional\)/)).toBeDefined();
  });

  it('renders the review step summary content with publish + draft buttons', async () => {
    const user = userEvent.setup();
    render(createElement(JobPostingForm));

    await advanceToStep(6, user);

    expect(screen.getByText(/Need to fix a leaky faucet please/)).toBeDefined();
    expect(screen.getByRole('button', { name: /Publish Job/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /Save as Draft/ })).toBeDefined();
    expect(screen.getByText(/How would you like to find a provider/)).toBeDefined();
  });

  it('lets the user toggle the instant match radio on the review step', async () => {
    const user = userEvent.setup();
    render(createElement(JobPostingForm));

    await advanceToStep(6, user);

    const instant = screen.getByRole('radio', { name: /Find me someone fast/ });
    await act(async () => {
      await user.click(instant);
    });
    expect((instant as HTMLInputElement).checked).toBe(true);
  });

  it('publishes the job and navigates to /jobs/mine on success', async () => {
    createJobMutateAsyncMock.mockResolvedValueOnce({ id: 'job-123' });
    const user = userEvent.setup();
    render(createElement(JobPostingForm));

    await advanceToStep(6, user);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /Publish Job/ }));
    });

    await waitFor(() => {
      expect(createJobMutateAsyncMock).toHaveBeenCalled();
    });
    expect(pushMock).toHaveBeenCalledWith('/jobs/mine');
  });

  it('calls the instant-match endpoint when the toggle is on and publish succeeds', async () => {
    createJobMutateAsyncMock.mockResolvedValueOnce({ id: 'job-456' });
    apiPostMock.mockResolvedValueOnce({ status: 'queued', expires_at: '2026-04-25T00:00:00Z' });
    const user = userEvent.setup();
    render(createElement(JobPostingForm));

    await advanceToStep(6, user);
    await act(async () => {
      await user.click(screen.getByRole('radio', { name: /Find me someone fast/ }));
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /Publish Job/ }));
    });

    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalledWith('/api/v1/jobs/job-456/instant-match');
    });
  });

  it('surfaces a root error message when publish fails', async () => {
    createJobMutateAsyncMock.mockRejectedValueOnce(new Error('Server unavailable'));
    const user = userEvent.setup();
    render(createElement(JobPostingForm));

    await advanceToStep(6, user);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /Publish Job/ }));
    });

    await waitFor(() => {
      expect(createJobMutateAsyncMock).toHaveBeenCalled();
    });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('saves a draft via Save as Draft when category and title are valid', async () => {
    createJobMutateAsyncMock.mockResolvedValueOnce({ id: 'draft-1' });
    const user = userEvent.setup();
    render(createElement(JobPostingForm));

    await advanceToStep(6, user);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /Save as Draft/ }));
    });

    await waitFor(() => {
      expect(createJobMutateAsyncMock).toHaveBeenCalled();
    });
    expect(pushMock).toHaveBeenCalledWith('/jobs/mine');
  });

  it('blocks step navigation forward via the step indicator buttons', () => {
    render(createElement(JobPostingForm));
    const nav = screen.getByRole('navigation', { name: /Job posting steps/ });
    const stepButtons = nav.querySelectorAll('button');
    // First step is current and enabled, the rest should be disabled
    expect(stepButtons[0]?.hasAttribute('disabled')).toBe(false);
    expect(stepButtons[1]?.hasAttribute('disabled')).toBe(true);
    expect(stepButtons[6]?.hasAttribute('disabled')).toBe(true);
  });

  it('allows clicking back to a previous step from the indicator nav after advancing', async () => {
    const user = userEvent.setup();
    render(createElement(JobPostingForm));

    await user.click(screen.getByTestId('mock-category-select'));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => {
      expect(screen.getByText(/Step 2 of 7/)).toBeDefined();
    });

    const nav = screen.getByRole('navigation', { name: /Job posting steps/ });
    const stepButtons = nav.querySelectorAll('button');
    // First step should now be clickable (idx < step)
    expect(stepButtons[0]?.hasAttribute('disabled')).toBe(false);

    if (stepButtons[0]) await user.click(stepButtons[0]);
    await waitFor(() => {
      expect(screen.getByText(/Step 1 of 7/)).toBeDefined();
    });
  });
});
