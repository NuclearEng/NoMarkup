// Job abuse-report hook — posts to the public-ish job report endpoint
// (optional auth). Reasons match the gateway CreateJobReport CHECK set
// (prohibited|misleading|spam|scam|harassment|other). Customers cannot
// report their own job; the gateway returns 403 for that case.

import { useMutation } from '@tanstack/react-query';

import { api } from '@/lib/api';

export const JOB_REPORT_REASONS = [
  { value: 'prohibited', label: 'Prohibited content' },
  { value: 'misleading', label: 'Misleading description' },
  { value: 'spam', label: 'Spam' },
  { value: 'scam', label: 'Scam' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'other', label: 'Something else' },
] as const;

export type JobReportReason = (typeof JOB_REPORT_REASONS)[number]['value'];

interface ReportJobInput {
  jobId: string;
  reason: JobReportReason;
  description?: string;
}

interface ReportJobResponse {
  id?: string;
  status: string;
  message?: string;
}

export function useReportJob() {
  return useMutation({
    mutationFn: ({ jobId, reason, description }: ReportJobInput) =>
      api.post<ReportJobResponse>(`/api/v1/jobs/${jobId}/report`, {
        reason,
        description: description ?? '',
      }),
  });
}
