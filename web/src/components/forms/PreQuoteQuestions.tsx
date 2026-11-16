'use client';

// Pre-quote questions form — Wave 5 audit Section H. Renders the
// admin-curated, per-category question set returned by
// useCategoryQuestions and emits SubmitAnswerInput[] up to the parent
// (typically JobPostingForm) on every change.
//
// The component intentionally takes `value` + `onChange` props rather
// than owning the state itself so the surrounding multi-step form can
// validate / submit answers atomically alongside the rest of the
// CreateJobInput payload.

import { useId, useMemo } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useCategoryQuestions } from '@/hooks/useCategoryQuestions';
import type { CategoryQuestion, SubmitAnswerInput } from '@/types';

export interface PreQuoteQuestionsProps {
  /** Selected service category. When empty the form renders nothing. */
  categoryId: string | undefined;
  /** Current answer payload — keyed by question_id for fast lookup. */
  value: Record<string, SubmitAnswerInput>;
  /** Called with the next full answer map on every field change. */
  onChange: (next: Record<string, SubmitAnswerInput>) => void;
}

/**
 * Renders zero-or-more dynamic fields based on the active category's
 * pre-quote question set.
 *
 * Empty list → renders an empty fragment (the post-job form skips the
 * step entirely when there are no questions for the category).
 */
export function PreQuoteQuestions({ categoryId, value, onChange }: PreQuoteQuestionsProps) {
  const { data: questions, isLoading, isError } = useCategoryQuestions(categoryId);

  const ordered = useMemo<CategoryQuestion[]>(() => {
    if (!questions) return [];
    return [...questions].sort((a, b) => a.display_order - b.display_order);
  }, [questions]);

  if (!categoryId) {
    return null;
  }
  if (isLoading) {
    return (
      <p className="text-muted-foreground text-sm" role="status" aria-live="polite">
        Loading questions...
      </p>
    );
  }
  if (isError) {
    return (
      <p className="text-destructive text-sm" role="alert">
        Could not load category questions. You can still post the job — providers will ask in chat.
      </p>
    );
  }
  if (ordered.length === 0) {
    return null;
  }

  function setText(questionId: string, text: string) {
    if (text === '') {
      const { [questionId]: _omit, ...rest } = value;
      void _omit;
      onChange(rest);
      return;
    }
    onChange({ ...value, [questionId]: { question_id: questionId, answer_text: text } });
  }

  function setJSON(questionId: string, json: unknown) {
    if (json === null || json === undefined) {
      const { [questionId]: _omit, ...rest } = value;
      void _omit;
      onChange(rest);
      return;
    }
    onChange({ ...value, [questionId]: { question_id: questionId, answer_json: json } });
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-medium">Project details</h3>
        <p className="text-muted-foreground text-xs">
          A few quick questions help providers quote accurately.
        </p>
      </div>
      {ordered.map((q) => (
        <QuestionField
          key={q.id}
          question={q}
          answer={value[q.id]}
          onText={(t) => {
            setText(q.id, t);
          }}
          onJSON={(j) => {
            setJSON(q.id, j);
          }}
        />
      ))}
    </div>
  );
}

interface QuestionFieldProps {
  question: CategoryQuestion;
  answer: SubmitAnswerInput | undefined;
  onText: (text: string) => void;
  onJSON: (json: unknown) => void;
}

// These answers live in the parent's state, not in the react-hook-form field
// registry, so the ui/form primitives (FormLabel, FormControl, ...) cannot be
// used here: they read a <FormField> context and throw without one, which
// crashed the job form for every category that has questions. Plain labels
// tied to their control by id give the same markup without that dependency.
function QuestionField({ question: q, answer, onText, onJSON }: QuestionFieldProps) {
  const fieldId = useId();
  const labelSuffix = q.required ? <span className="text-destructive ml-0.5">*</span> : null;

  if (q.question_type === 'text') {
    return (
      <div className="space-y-2">
        <Label htmlFor={fieldId}>
          {q.question}
          {labelSuffix}
        </Label>
        <Textarea
          id={fieldId}
          rows={3}
          value={answer?.answer_text ?? ''}
          onChange={(e) => {
            onText(e.target.value);
          }}
          className="resize-none"
          aria-required={q.required}
        />
      </div>
    );
  }

  if (q.question_type === 'number') {
    const num =
      typeof answer?.answer_json === 'number'
        ? String(answer.answer_json)
        : (answer?.answer_text ?? '');
    return (
      <div className="space-y-2">
        <Label htmlFor={fieldId}>
          {q.question}
          {labelSuffix}
        </Label>
        <Input
          id={fieldId}
          type="number"
          inputMode="numeric"
          value={num}
          min={0}
          className="min-h-[44px]"
          aria-required={q.required}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '') {
              onJSON(null);
              return;
            }
            const parsed = Number(v);
            if (Number.isFinite(parsed)) onJSON(parsed);
          }}
        />
      </div>
    );
  }

  if (q.question_type === 'date') {
    return (
      <div className="space-y-2">
        <Label htmlFor={fieldId}>
          {q.question}
          {labelSuffix}
        </Label>
        <Input
          id={fieldId}
          type="date"
          value={answer?.answer_text ?? ''}
          className="min-h-[44px]"
          aria-required={q.required}
          onChange={(e) => {
            onText(e.target.value);
          }}
        />
      </div>
    );
  }

  if (q.question_type === 'boolean') {
    const checked =
      typeof answer?.answer_json === 'boolean'
        ? answer.answer_json
        : answer?.answer_text === 'true';
    return (
      <div className="flex min-h-[44px] items-center gap-3">
        <Checkbox
          id={fieldId}
          checked={checked}
          onCheckedChange={(c) => {
            onJSON(c === true);
          }}
          aria-required={q.required}
        />
        <Label htmlFor={fieldId} className="cursor-pointer">
          {q.question}
          {labelSuffix}
        </Label>
      </div>
    );
  }

  if (q.question_type === 'select') {
    const opts = Array.isArray(q.options) ? q.options : [];
    return (
      <div className="space-y-2">
        <Label htmlFor={fieldId}>
          {q.question}
          {labelSuffix}
        </Label>
        <Select
          value={answer?.answer_text ?? ''}
          onValueChange={(v) => {
            onText(v);
          }}
        >
          <SelectTrigger id={fieldId} className="min-h-[44px]" aria-required={q.required}>
            <SelectValue placeholder="Select an option" />
          </SelectTrigger>
          <SelectContent>
            {opts.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (q.question_type === 'multiselect') {
    const opts = Array.isArray(q.options) ? q.options : [];
    const selected = Array.isArray(answer?.answer_json) ? (answer.answer_json as string[]) : [];

    function toggle(opt: string) {
      const next = selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt];
      onJSON(next);
    }

    return (
      <div className="space-y-2">
        <p id={fieldId} className="text-sm leading-none font-medium">
          {q.question}
          {labelSuffix}
        </p>
        <p className="text-muted-foreground text-sm">Choose all that apply.</p>
        <div role="group" aria-labelledby={fieldId} className="flex flex-wrap gap-2">
          {opts.map((o) => {
            const isOn = selected.includes(o);
            return (
              <button
                key={o}
                type="button"
                onClick={() => {
                  toggle(o);
                }}
                aria-pressed={isOn}
                className={`min-h-[44px] rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                  isOn
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border hover:bg-muted'
                }`}
              >
                {o}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Unknown question_type — fall back to text so the question still
  // collects something rather than crashing the form.
  return (
    <div className="space-y-2">
      <Label htmlFor={fieldId}>{q.question}</Label>
      <Input
        id={fieldId}
        value={answer?.answer_text ?? ''}
        onChange={(e) => {
          onText(e.target.value);
        }}
        className="min-h-[44px]"
      />
    </div>
  );
}
