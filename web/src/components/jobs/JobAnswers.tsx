'use client';

import { useAuthStore } from '@/stores/auth-store';
import { useCategoryQuestions, useJobAnswers } from '@/hooks/useCategoryQuestions';
import type { JobQuestionAnswer } from '@/types';

interface JobAnswersProps {
  jobId: string;
  categoryId: string | undefined;
}

function answerLabel(answer: JobQuestionAnswer): string {
  if (typeof answer.answer_text === 'string' && answer.answer_text.trim() !== '') {
    return answer.answer_text;
  }
  const json = answer.answer_json;
  if (typeof json === 'string' || typeof json === 'number' || typeof json === 'boolean') {
    return String(json);
  }
  if (Array.isArray(json)) {
    return json.map((item) => String(item)).join(', ');
  }
  return '';
}

/**
 * Project-detail answers the customer submitted with the job.
 * Visible to the owner, an admin, and providers who have bid.
 * Everyone else gets 404 from the gateway and this renders nothing.
 */
export function JobAnswers({ jobId, categoryId }: JobAnswersProps) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { data: answers, isError } = useJobAnswers(isAuthenticated ? jobId : undefined);
  const { data: questions } = useCategoryQuestions(categoryId);

  if (!isAuthenticated || isError || !answers || answers.length === 0) {
    return null;
  }

  const questionById = new Map((questions ?? []).map((question) => [question.id, question.question]));
  const rows = answers
    .map((answer) => ({
      id: answer.id,
      question: questionById.get(answer.question_id) ?? 'Answer',
      value: answerLabel(answer),
    }))
    .filter((row) => row.value !== '');

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3" data-testid="job-answers">
      <h2 className="text-lg font-semibold">Project details</h2>
      <dl className="space-y-3">
        {rows.map((row) => (
          <div key={row.id}>
            <dt className="text-muted-foreground text-xs">{row.question}</dt>
            <dd className="text-sm whitespace-pre-wrap">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
