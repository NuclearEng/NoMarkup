import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('JobPostingForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createJobMutateAsyncMock.mockReset();
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
});
