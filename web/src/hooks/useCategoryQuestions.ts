import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
  CategoryQuestion,
  CategoryQuestionsResponse,
  JobQuestionAnswer,
  SubmitAnswersInput,
} from '@/types';

/**
 * Fetches the ordered question set for a service category. Public
 * endpoint — safe to call before the user has authed.
 *
 * Returns an empty list when categoryId is empty so the form can mount
 * the hook unconditionally and let the user pick a category first.
 */
export function useCategoryQuestions(categoryId: string | undefined) {
  return useQuery({
    queryKey: ['categoryQuestions', categoryId ?? ''],
    queryFn: async (): Promise<CategoryQuestion[]> => {
      if (!categoryId) return [];
      const res = await api.get<CategoryQuestionsResponse>(
        `/api/v1/categories/${categoryId}/questions`,
      );
      return res.questions;
    },
    enabled: Boolean(categoryId),
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

interface JobAnswersResponse {
  answers: JobQuestionAnswer[];
}

/**
 * Fetches a job's submitted answers. Auth-gated — only the customer
 * who posted the job, providers with active bids on it, and admins
 * receive a non-empty payload; everyone else sees a 404 (which the
 * hook surfaces as an error).
 */
export function useJobAnswers(jobId: string | undefined) {
  return useQuery({
    queryKey: ['jobAnswers', jobId ?? ''],
    queryFn: async (): Promise<JobQuestionAnswer[]> => {
      if (!jobId) return [];
      const res = await api.get<JobAnswersResponse>(`/api/v1/jobs/${jobId}/answers`);
      return res.answers;
    },
    enabled: Boolean(jobId),
    staleTime: 30 * 1000,
  });
}

/**
 * Submits the customer's answers for a job. Upserts on
 * (job_id, question_id) so re-submission updates in place.
 */
export function useSubmitJobAnswers(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SubmitAnswersInput): Promise<{ saved: number }> => {
      return api.post<{ saved: number }>(`/api/v1/jobs/${jobId}/answers`, input);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['jobAnswers', jobId] });
    },
  });
}
