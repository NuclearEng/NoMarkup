import { fireEvent, render, screen } from '@testing-library/react';
import { createContext, useContext, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CategoryQuestion, SubmitAnswerInput } from '@/types';

interface QuestionsQueryState {
  data: CategoryQuestion[] | undefined;
  isLoading: boolean;
  isError: boolean;
}

const queryState: QuestionsQueryState = { data: undefined, isLoading: false, isError: false };
const requestedCategoryIds: (string | undefined)[] = [];

vi.mock('@/hooks/useCategoryQuestions', () => ({
  useCategoryQuestions: (categoryId: string | undefined) => {
    requestedCategoryIds.push(categoryId);
    return queryState;
  },
}));

// The shadcn Form primitives call useFormField(), which throws unless they sit
// inside a <FormField>. PreQuoteQuestions renders them bare (see the it.todo at
// the bottom), so the field logic is exercised here against pass-through
// stand-ins.
vi.mock('@/components/ui/form', () => ({
  FormItem: ({ children }: { children?: ReactNode }) => <div data-testid="form-item">{children}</div>,
  FormLabel: ({ children }: { children?: ReactNode }) => <span data-testid="form-label">{children}</span>,
  FormControl: ({ children }: { children?: ReactNode }) => <>{children}</>,
  FormDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  FormMessage: () => null,
}));

// Radix Select needs pointer capture + portals; a listbox of clickable options
// keeps the onValueChange contract without the jsdom gaps.
vi.mock('@/components/ui/select', () => {
  const Ctx = createContext<{ value: string; onValueChange: (v: string) => void }>({
    value: '',
    onValueChange: () => undefined,
  });
  function Select({
    children,
    value,
    onValueChange,
  }: {
    children?: ReactNode;
    value?: string;
    onValueChange?: (v: string) => void;
  }) {
    return (
      <Ctx.Provider value={{ value: value ?? '', onValueChange: onValueChange ?? (() => undefined) }}>
        <div role="listbox" data-value={value ?? ''}>
          {children}
        </div>
      </Ctx.Provider>
    );
  }
  function SelectItem({ children, value }: { children?: ReactNode; value: string }) {
    const ctx = useContext(Ctx);
    return (
      <div
        role="option"
        tabIndex={0}
        aria-selected={ctx.value === value}
        onClick={() => {
          ctx.onValueChange(value);
        }}
        onKeyDown={() => undefined}
      >
        {children}
      </div>
    );
  }
  return {
    Select,
    SelectItem,
    SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
    SelectTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  };
});

import { PreQuoteQuestions } from '@/components/forms/PreQuoteQuestions';

function question(overrides: Partial<CategoryQuestion>): CategoryQuestion {
  return {
    id: 'q1',
    category_id: 'cat-1',
    question: 'How big is the area?',
    question_type: 'text',
    options: null,
    required: false,
    display_order: 1,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const onChange = vi.fn<(next: Record<string, SubmitAnswerInput>) => void>();

function renderForm(value: Record<string, SubmitAnswerInput> = {}) {
  return render(<PreQuoteQuestions categoryId="cat-1" value={value} onChange={onChange} />);
}

beforeEach(() => {
  onChange.mockClear();
  requestedCategoryIds.length = 0;
  queryState.data = undefined;
  queryState.isLoading = false;
  queryState.isError = false;
});

describe('PreQuoteQuestions gating states', () => {
  it('renders nothing until a category is chosen, even if questions are cached', () => {
    queryState.data = [question({})];
    const { container } = render(
      <PreQuoteQuestions categoryId={undefined} value={{}} onChange={onChange} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(requestedCategoryIds).toEqual([undefined]);
  });

  it('announces loading', () => {
    queryState.isLoading = true;
    renderForm();
    expect(screen.getByRole('status')).toHaveTextContent('Loading questions...');
    expect(requestedCategoryIds).toEqual(['cat-1']);
  });

  it('shows a non-blocking error alert when the questions fail to load', () => {
    queryState.isError = true;
    renderForm();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not load category questions. You can still post the job — providers will ask in chat.',
    );
  });

  it('renders nothing for a category with no questions or no payload', () => {
    queryState.data = [];
    const { container, rerender } = renderForm();
    expect(container).toBeEmptyDOMElement();
    queryState.data = undefined;
    rerender(<PreQuoteQuestions categoryId="cat-1" value={{}} onChange={onChange} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('orders questions by display_order and marks only required ones', () => {
    queryState.data = [
      question({ id: 'b', question: 'Second', display_order: 2, required: true }),
      question({ id: 'a', question: 'First', display_order: 1 }),
    ];
    renderForm();
    expect(screen.getByText('Project details')).toBeInTheDocument();
    const labels = screen.getAllByTestId('form-label').map((l) => l.textContent);
    expect(labels).toEqual(['First', 'Second*']);
    const boxes = screen.getAllByRole('textbox');
    expect(boxes[0]).toHaveAttribute('aria-required', 'false');
    expect(boxes[1]).toHaveAttribute('aria-required', 'true');
  });
});

describe('PreQuoteQuestions text / date / fallback fields', () => {
  it('emits answer_text for a text question while preserving other answers', () => {
    queryState.data = [question({ id: 'q1' })];
    const other: SubmitAnswerInput = { question_id: 'other', answer_text: 'keep' };
    renderForm({ other });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '200 sq ft' } });
    expect(onChange).toHaveBeenCalledWith({
      other,
      q1: { question_id: 'q1', answer_text: '200 sq ft' },
    });
  });

  it('drops the answer entirely when a text field is cleared', () => {
    queryState.data = [question({ id: 'q1' })];
    const other: SubmitAnswerInput = { question_id: 'other', answer_text: 'keep' };
    renderForm({ other, q1: { question_id: 'q1', answer_text: 'old' } });
    expect(screen.getByRole('textbox')).toHaveValue('old');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith({ other });
  });

  it('emits the ISO date string for a date question', () => {
    queryState.data = [question({ id: 'd1', question_type: 'date', required: true })];
    const { container } = renderForm({ d1: { question_id: 'd1', answer_text: '2026-12-01' } });
    const input = container.querySelector('input[type="date"]');
    expect(input).toHaveValue('2026-12-01');
    expect(input).toHaveAttribute('aria-required', 'true');
    if (input) fireEvent.change(input, { target: { value: '2026-12-24' } });
    expect(onChange).toHaveBeenCalledWith({ d1: { question_id: 'd1', answer_text: '2026-12-24' } });
  });

  it('starts an unanswered date question empty', () => {
    queryState.data = [question({ id: 'd1', question_type: 'date' })];
    const { container } = renderForm();
    expect(container.querySelector('input[type="date"]')).toHaveValue('');
  });

  it('falls back to a plain text input for an unknown question type, without a required marker', () => {
    const unknown = { ...question({ id: 'u1', required: true }), question_type: 'slider' } as unknown as CategoryQuestion;
    queryState.data = [unknown];
    renderForm({ u1: { question_id: 'u1', answer_text: 'abc' } });
    expect(screen.getByTestId('form-label')).toHaveTextContent(/^How big is the area\?$/);
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('abc');
    fireEvent.change(input, { target: { value: 'abcd' } });
    expect(onChange).toHaveBeenCalledWith({ u1: { question_id: 'u1', answer_text: 'abcd' } });
  });

  it('shows an unknown-type question empty when unanswered', () => {
    const unknown = { ...question({ id: 'u1' }), question_type: 'slider' } as unknown as CategoryQuestion;
    queryState.data = [unknown];
    renderForm();
    expect(screen.getByRole('textbox')).toHaveValue('');
  });
});

describe('PreQuoteQuestions number field', () => {
  beforeEach(() => {
    queryState.data = [question({ id: 'n1', question_type: 'number', required: true })];
  });

  it('shows a stored JSON number and emits parsed numbers as answer_json', () => {
    renderForm({ n1: { question_id: 'n1', answer_json: 3 } });
    const input = screen.getByRole('spinbutton');
    expect(input).toHaveValue(3);
    expect(input).toHaveAttribute('aria-required', 'true');
    fireEvent.change(input, { target: { value: '42' } });
    expect(onChange).toHaveBeenCalledWith({ n1: { question_id: 'n1', answer_json: 42 } });
  });

  it('falls back to a stored text answer, then to empty', () => {
    const { rerender } = renderForm({ n1: { question_id: 'n1', answer_text: '7' } });
    expect(screen.getByRole('spinbutton')).toHaveValue(7);
    rerender(<PreQuoteQuestions categoryId="cat-1" value={{}} onChange={onChange} />);
    expect(screen.getByRole('spinbutton')).toHaveValue(null);
  });

  it('removes the answer when the number is cleared', () => {
    renderForm({ n1: { question_id: 'n1', answer_json: 3 } });
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith({});
  });
});

describe('PreQuoteQuestions boolean field', () => {
  beforeEach(() => {
    queryState.data = [question({ id: 'b1', question_type: 'boolean', question: 'Pets at home?' })];
  });

  it('is unchecked by default and emits true when ticked', () => {
    renderForm();
    const box = screen.getByRole('checkbox');
    expect(box).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith({ b1: { question_id: 'b1', answer_json: true } });
  });

  it('reads a stored JSON boolean and emits false when unticked', () => {
    renderForm({ b1: { question_id: 'b1', answer_json: true } });
    const box = screen.getByRole('checkbox');
    expect(box).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith({ b1: { question_id: 'b1', answer_json: false } });
  });

  it('treats a legacy "true" text answer as checked and other text as unchecked', () => {
    const { rerender } = renderForm({ b1: { question_id: 'b1', answer_text: 'true' } });
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
    rerender(
      <PreQuoteQuestions
        categoryId="cat-1"
        value={{ b1: { question_id: 'b1', answer_text: 'yes' } }}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'false');
  });
});

describe('PreQuoteQuestions select field', () => {
  it('lists the options and emits the picked one as answer_text', () => {
    queryState.data = [
      question({ id: 's1', question_type: 'select', options: ['Gas', 'Electric'], required: true }),
    ];
    renderForm({ s1: { question_id: 's1', answer_text: 'Gas' } });
    expect(screen.getByRole('listbox')).toHaveAttribute('data-value', 'Gas');
    expect(screen.getByRole('option', { name: 'Gas' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('option', { name: 'Electric' }));
    expect(onChange).toHaveBeenCalledWith({ s1: { question_id: 's1', answer_text: 'Electric' } });
  });

  it('renders no options when the question has none configured', () => {
    queryState.data = [question({ id: 's1', question_type: 'select', options: null })];
    renderForm();
    expect(screen.getByRole('listbox')).toHaveAttribute('data-value', '');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(screen.getByText('Select an option')).toBeInTheDocument();
  });
});

describe('PreQuoteQuestions multiselect field', () => {
  it('adds an option to the selection', () => {
    queryState.data = [
      question({ id: 'm1', question_type: 'multiselect', options: ['Tile', 'Wood', 'Carpet'], required: true }),
    ];
    renderForm({ m1: { question_id: 'm1', answer_json: ['Tile'] } });
    expect(screen.getByText('Choose all that apply.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tile' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Wood' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Wood' }));
    expect(onChange).toHaveBeenCalledWith({
      m1: { question_id: 'm1', answer_json: ['Tile', 'Wood'] },
    });
  });

  it('removes an already-selected option, emitting an empty array rather than deleting the answer', () => {
    queryState.data = [question({ id: 'm1', question_type: 'multiselect', options: ['Tile', 'Wood'] })];
    renderForm({ m1: { question_id: 'm1', answer_json: ['Tile'] } });
    fireEvent.click(screen.getByRole('button', { name: 'Tile' }));
    expect(onChange).toHaveBeenCalledWith({ m1: { question_id: 'm1', answer_json: [] } });
  });

  it('treats a non-array stored answer as nothing selected', () => {
    queryState.data = [question({ id: 'm1', question_type: 'multiselect', options: ['Tile'] })];
    renderForm({ m1: { question_id: 'm1', answer_json: 'Tile' } });
    expect(screen.getByRole('button', { name: 'Tile' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Tile' }));
    expect(onChange).toHaveBeenCalledWith({ m1: { question_id: 'm1', answer_json: ['Tile'] } });
  });

  it('renders no toggle buttons when options are missing', () => {
    queryState.data = [question({ id: 'm1', question_type: 'multiselect', options: null })];
    renderForm();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('PreQuoteQuestions known defects', () => {
  it.todo(
    'BUG src/components/forms/PreQuoteQuestions.tsx:137 — QuestionField renders FormLabel/FormControl/FormDescription outside a <FormField>, so the real ui/form primitives throw "useFormField should be used within <FormField>" as soon as a category has questions (JobPostingForm.tsx:664)',
  );
});
