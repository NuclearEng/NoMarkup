// User & message abuse-report hook — closes the gap where only listings
// could be flagged. Posts to the owner-scoped report endpoint; the gateway
// enforces no-self-report and dedups open reports against the same target.
//
// The mutation is intentionally context-light: a reason (required) plus an
// optional free-text description and optional chat context (channel/message)
// so the same hook serves the chat header and a profile "Report" action.

import { useMutation } from '@tanstack/react-query';

import { api } from '@/lib/api';

export const REPORT_REASONS = [
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'spam', label: 'Spam' },
  { value: 'scam', label: 'Scam or fraud' },
  { value: 'inappropriate', label: 'Inappropriate content' },
  { value: 'other', label: 'Something else' },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]['value'];

interface ReportUserInput {
  /** The user being reported. */
  userId: string;
  reason: ReportReason;
  description?: string;
  /** Optional chat context so a moderator can find the offending thread. */
  channelId?: string;
  messageId?: string;
}

interface ReportUserResponse {
  id?: string;
  status: string;
  message?: string;
}

export function useReportUser() {
  return useMutation({
    mutationFn: ({ userId, reason, description, channelId, messageId }: ReportUserInput) =>
      api.post<ReportUserResponse>(`/api/v1/users/${userId}/report`, {
        reason,
        description: description ?? '',
        channel_id: channelId ?? '',
        message_id: messageId ?? '',
      }),
  });
}
