// JobPostingForm — a category that has pre-quote questions, end to end:
// pick the category, answer the questions on the Details step, publish, and
// check the answers that reach POST /jobs/{id}/answers.
//
// PreQuoteQuestions used the ui/form primitives without a <FormField>, so
// useFormField threw and the whole job form crashed as soon as the chosen
// category had questions. The existing form test stubs the questions query to
// an empty list, which is why it never saw this.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CategoryQuestion } from '@/types';

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
  // jsdom doesn't implement URL.createObjectURL — needed for photo previews.
  Object.defineProperty(globalThis.URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(() => 'blob:mock://preview'),
  });
  Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

const pushMock = vi.fn();
const searchParamsState = { current: new URLSearchParams() };
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/jobs/new',
  useSearchParams: () => searchParamsState.current,
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
  useCategories: () => ({
    data: [
      { id: 'cat-1', name: 'Plumbing', slug: 'plumbing' },
      { id: 'cat-2', name: 'Electrical', slug: 'electrical' },
    ],
    isLoading: false,
  }),
  useCategoryTree: () => ({ data: [], isLoading: false }),
}));

const SAMPLE_PROPERTY = {
  id: 'prop-1',
  nickname: 'Home',
  address: {
    street: '123 Main St',
    city: 'Austin',
    state: 'TX',
    zip_code: '78701',
    latitude: 30.2672,
    longitude: -97.7431,
  },
  notes: null,
  created_at: '2026-01-01T00:00:00Z',
};

const propertiesState: { data: typeof SAMPLE_PROPERTY[] | undefined; isLoading: boolean } = {
  data: [SAMPLE_PROPERTY],
  isLoading: false,
};

vi.mock('@/hooks/useProperties', () => ({
  useProperties: () => propertiesState,
}));

const fairPriceState: {
  data: {
    has_data: boolean;
    p25_cents?: number;
    price_cents?: number;
    p75_cents?: number;
    n_eff?: number;
  };
  isLoading: boolean;
  isError: boolean;
} = {
  data: { has_data: false },
  isLoading: false,
  isError: false,
};

const useFairPriceMock = vi.fn((_args?: unknown) => fairPriceState);

vi.mock('@/hooks/useAnalytics', () => ({
  useFairPrice: (args: unknown) => useFairPriceMock(args),
}));

// The questions query is the only part of the pre-quote path that is mocked:
// PreQuoteQuestions and the ui/form primitives render for real.
const questionsState: { data: CategoryQuestion[]; isLoading: boolean; isError: boolean } = {
  data: [],
  isLoading: false,
  isError: false,
};
const requestedCategoryIds: (string | undefined)[] = [];
vi.mock('@/hooks/useCategoryQuestions', () => ({
  useCategoryQuestions: (categoryId: string | undefined) => {
    requestedCategoryIds.push(categoryId);
    return questionsState;
  },
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
  MarketRangeDisplay: () => createElement('div', { 'data-testid': 'market-range' }, 'Market range'),
}));

vi.mock('@/components/forms/ImageAnalysisButton', () => ({
  ImageAnalysisButton: ({
    onResult,
  }: {
    onResult: (r: { title: string; description: string; category: string }) => void;
  }) =>
    createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'mock-image-analysis',
        onClick: () => {
          onResult({
            title: 'AI suggested title for the job',
            description:
              'AI generated description that is plenty long enough to satisfy minimum length validators.',
            category: 'Plumbing',
          });
        },
      },
      'AI Analyze',
    ),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const { JobPostingForm } = await import('@/components/forms/JobPostingForm');


function question(overrides: Partial<CategoryQuestion>): CategoryQuestion {
  return {
    id: 'q',
    category_id: 'cat-1',
    question: 'Question',
    question_type: 'text',
    options: null,
    required: false,
    display_order: 1,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const QUESTIONS: CategoryQuestion[] = [
  question({ id: 'q-area', question: 'How big is the area?', question_type: 'text', required: true, display_order: 1 }),
  question({ id: 'q-fixtures', question: 'How many fixtures?', question_type: 'number', display_order: 2 }),
  question({ id: 'q-date', question: 'When was it last serviced?', question_type: 'date', display_order: 3 }),
  question({ id: 'q-pets', question: 'Any pets on site?', question_type: 'boolean', display_order: 4 }),
  question({
    id: 'q-rooms',
    question: 'Which rooms?',
    question_type: 'multiselect',
    options: ['Kitchen', 'Bathroom', 'Garage'],
    display_order: 5,
  }),
  question({
    id: 'q-urgency',
    question: 'How urgent is it?',
    question_type: 'select',
    options: ['Today', 'This week'],
    display_order: 6,
  }),
];

const TITLE = 'Need to fix a leaky faucet please';
const DESCRIPTION =
  'This is a long enough description to satisfy the minimum 50 character validation rule for sure now.';

async function toDetails(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('mock-category-select'));
  await user.click(screen.getByRole('button', { name: /Next/ }));
  await waitFor(() => {
    expect(screen.getByText(/Step 2 of 7/)).toBeDefined();
  });
}

async function fromDetailsToReview(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText(/Kitchen sink repair/), TITLE);
  await user.type(screen.getByPlaceholderText(/Describe the work you need done in detail/), DESCRIPTION);
  for (const step of [3, 4, 5, 6, 7]) {
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => {
      expect(screen.getByText(new RegExp(`Step ${String(step)} of 7`))).toBeDefined();
    });
  }
}

function answersCall(): { path: string; body: unknown } | undefined {
  const call = apiPostMock.mock.calls.find(
    ([path]) => typeof path === 'string' && path.endsWith('/answers'),
  );
  return call ? { path: call[0] as string, body: call[1] } : undefined;
}

describe('JobPostingForm — category with pre-quote questions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createJobMutateAsyncMock.mockReset();
    apiPostMock.mockReset();
    pushMock.mockReset();
    requestedCategoryIds.length = 0;
    questionsState.data = QUESTIONS;
    questionsState.isLoading = false;
    questionsState.isError = false;
  });

  it('renders every question on the Details step, each label tied to its control', async () => {
    const user = userEvent.setup();
    render(createElement(JobPostingForm));
    await toDetails(user);

    expect(screen.getByText('Project details')).toBeDefined();
    expect(requestedCategoryIds).toContain('cat-1');
    expect(screen.getByLabelText(/How big is the area\?/).tagName).toBe('TEXTAREA');
    expect(screen.getByLabelText(/How big is the area\?/).getAttribute('aria-required')).toBe('true');
    expect(screen.getByLabelText('How many fixtures?').getAttribute('type')).toBe('number');
    expect(screen.getByLabelText('When was it last serviced?').getAttribute('type')).toBe('date');
    expect(screen.getByLabelText('Any pets on site?').getAttribute('role')).toBe('checkbox');
    const rooms = screen.getByRole('group', { name: 'Which rooms?' });
    expect(within(rooms).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Kitchen',
      'Bathroom',
      'Garage',
    ]);
    expect(screen.getByLabelText('How urgent is it?').getAttribute('role')).toBe('combobox');
  });

  it('sends the answers given on the Details step with the published job', async () => {
    const user = userEvent.setup();
    createJobMutateAsyncMock.mockResolvedValue({ id: 'job-9' });
    apiPostMock.mockResolvedValue({ saved: 4 });
    render(createElement(JobPostingForm));
    await toDetails(user);

    await user.type(screen.getByLabelText(/How big is the area\?/), '200 sq ft');
    await user.type(screen.getByLabelText('How many fixtures?'), '3');
    await user.click(screen.getByLabelText('Any pets on site?'));
    const rooms = screen.getByRole('group', { name: 'Which rooms?' });
    await user.click(within(rooms).getByRole('button', { name: 'Kitchen' }));
    await user.click(within(rooms).getByRole('button', { name: 'Garage' }));
    expect(within(rooms).getByRole('button', { name: 'Garage' }).getAttribute('aria-pressed')).toBe('true');

    await fromDetailsToReview(user);
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /Publish Job/ }));
    });

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/jobs/mine');
    });
    expect(createJobMutateAsyncMock).toHaveBeenCalledTimes(1);
    expect(answersCall()).toEqual({
      path: '/api/v1/jobs/job-9/answers',
      body: {
        answers: [
          { question_id: 'q-area', answer_text: '200 sq ft' },
          { question_id: 'q-fixtures', answer_json: 3 },
          { question_id: 'q-pets', answer_json: true },
          { question_id: 'q-rooms', answer_json: ['Kitchen', 'Garage'] },
        ],
      },
    });
  });

  it('keeps the answers when the user goes forward and comes back to Details', async () => {
    const user = userEvent.setup();
    render(createElement(JobPostingForm));
    await toDetails(user);
    await user.type(screen.getByLabelText(/How big is the area\?/), '200 sq ft');
    await user.type(screen.getByPlaceholderText(/Kitchen sink repair/), TITLE);
    await user.type(screen.getByPlaceholderText(/Describe the work you need done in detail/), DESCRIPTION);
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => {
      expect(screen.getByText(/Step 3 of 7/)).toBeDefined();
    });

    await user.click(screen.getByRole('button', { name: /Previous/ }));

    expect(await screen.findByLabelText(/How big is the area\?/)).toHaveProperty('value', '200 sq ft');
  });

  it('posts no answers when the questions were left blank', async () => {
    const user = userEvent.setup();
    createJobMutateAsyncMock.mockResolvedValue({ id: 'job-9' });
    render(createElement(JobPostingForm));
    await toDetails(user);
    await fromDetailsToReview(user);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /Publish Job/ }));
    });

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/jobs/mine');
    });
    expect(answersCall()).toBeUndefined();
  });
});
