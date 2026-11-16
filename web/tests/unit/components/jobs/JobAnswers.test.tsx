import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CategoryQuestion, JobQuestionAnswer } from '@/types';

const authState = { isAuthenticated: true };
const answersState: { data: JobQuestionAnswer[] | undefined; isError: boolean } = {
  data: undefined,
  isError: false,
};
const questionsState: { data: CategoryQuestion[] | undefined } = { data: undefined };
const answersRequestedFor: (string | undefined)[] = [];
const questionsRequestedFor: (string | undefined)[] = [];

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: { isAuthenticated: boolean }) => unknown) => selector(authState),
}));

vi.mock('@/hooks/useCategoryQuestions', () => ({
  useJobAnswers: (jobId: string | undefined) => {
    answersRequestedFor.push(jobId);
    return answersState;
  },
  useCategoryQuestions: (categoryId: string | undefined) => {
    questionsRequestedFor.push(categoryId);
    return questionsState;
  },
}));

import { JobAnswers } from '@/components/jobs/JobAnswers';

function answer(overrides: Partial<JobQuestionAnswer>): JobQuestionAnswer {
  return {
    id: 'a1',
    job_id: 'job-1',
    question_id: 'q1',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function question(id: string, text: string): CategoryQuestion {
  return {
    id,
    category_id: 'cat-1',
    question: text,
    question_type: 'text',
    required: false,
    display_order: 1,
    created_at: '2026-01-01T00:00:00Z',
  };
}

function rows(): { question: string; value: string }[] {
  const terms = screen.getAllByRole('term');
  const defs = screen.getAllByRole('definition');
  return terms.map((t, i) => ({ question: t.textContent, value: defs[i]?.textContent ?? '' }));
}

beforeEach(() => {
  authState.isAuthenticated = true;
  answersState.data = undefined;
  answersState.isError = false;
  questionsState.data = undefined;
  answersRequestedFor.length = 0;
  questionsRequestedFor.length = 0;
});

describe('JobAnswers', () => {
  it('renders nothing and does not request answers for a signed-out visitor', () => {
    authState.isAuthenticated = false;
    answersState.data = [answer({ answer_text: 'secret' })];
    const { container } = render(<JobAnswers jobId="job-1" categoryId="cat-1" />);
    expect(container).toBeEmptyDOMElement();
    expect(answersRequestedFor).toEqual([undefined]);
  });

  it('requests answers for the job and questions for the category when signed in', () => {
    render(<JobAnswers jobId="job-1" categoryId="cat-1" />);
    expect(answersRequestedFor).toEqual(['job-1']);
    expect(questionsRequestedFor).toEqual(['cat-1']);
  });

  it('renders nothing when the gateway denies access', () => {
    answersState.isError = true;
    answersState.data = [answer({ answer_text: 'stale' })];
    const { container } = render(<JobAnswers jobId="job-1" categoryId="cat-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while answers are missing or empty', () => {
    const { container, rerender } = render(<JobAnswers jobId="job-1" categoryId="cat-1" />);
    expect(container).toBeEmptyDOMElement();
    answersState.data = [];
    rerender(<JobAnswers jobId="job-1" categoryId="cat-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when every answer is blank', () => {
    answersState.data = [
      answer({ id: 'a1', answer_text: '   ' }),
      answer({ id: 'a2', answer_text: null, answer_json: null }),
      answer({ id: 'a3', answer_json: { nested: true } }),
    ];
    const { container } = render(<JobAnswers jobId="job-1" categoryId="cat-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('pairs each answer with its question text and formats every answer shape', () => {
    questionsState.data = [
      question('q-text', 'Describe the leak'),
      question('q-num', 'How many rooms?'),
      question('q-bool', 'Pets at home?'),
      question('q-multi', 'Floor types'),
      question('q-str', 'Fuel'),
    ];
    answersState.data = [
      answer({ id: 'a1', question_id: 'q-text', answer_text: 'Under the sink' }),
      answer({ id: 'a2', question_id: 'q-num', answer_json: 3 }),
      answer({ id: 'a3', question_id: 'q-bool', answer_json: false }),
      answer({ id: 'a4', question_id: 'q-multi', answer_json: ['Tile', 'Wood', 2] }),
      answer({ id: 'a5', question_id: 'q-str', answer_text: '', answer_json: 'Gas' }),
      answer({ id: 'a6', question_id: 'q-text', answer_text: null }),
    ];
    render(<JobAnswers jobId="job-1" categoryId="cat-1" />);
    const section = screen.getByTestId('job-answers');
    expect(within(section).getByRole('heading', { name: 'Project details' })).toBeInTheDocument();
    expect(rows()).toEqual([
      { question: 'Describe the leak', value: 'Under the sink' },
      { question: 'How many rooms?', value: '3' },
      { question: 'Pets at home?', value: 'false' },
      { question: 'Floor types', value: 'Tile, Wood, 2' },
      { question: 'Fuel', value: 'Gas' },
    ]);
  });

  it('labels answers "Answer" when the question catalog is unavailable or lacks the id', () => {
    answersState.data = [answer({ id: 'a1', question_id: 'gone', answer_text: 'Yes' })];
    const { rerender } = render(<JobAnswers jobId="job-1" categoryId={undefined} />);
    expect(rows()).toEqual([{ question: 'Answer', value: 'Yes' }]);
    expect(questionsRequestedFor).toEqual([undefined]);

    questionsState.data = [question('other', 'Unrelated')];
    rerender(<JobAnswers jobId="job-1" categoryId="cat-1" />);
    expect(rows()).toEqual([{ question: 'Answer', value: 'Yes' }]);
  });
});
