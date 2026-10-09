import { useQuery } from '@tanstack/react-query';

import { ApiError, api } from '@/lib/api';

export const WORK_EVIDENCE_MISSING = {
  CHECK_IN: 'check_in',
  AFTER_PHOTO: 'after_photo',
} as const;

export type WorkEvidenceMissing =
  (typeof WORK_EVIDENCE_MISSING)[keyof typeof WORK_EVIDENCE_MISSING];

export interface WorkEvidenceSession {
  checked_in_at: string;
  checked_out_at: string | null;
  duration_minutes: number;
}

export interface WorkEvidencePhoto {
  phase: 'before' | 'after' | string;
  url: string;
  uploaded_at: string;
}

export interface WorkEvidence {
  ready_for_release: boolean;
  missing: string[];
  sessions: WorkEvidenceSession[];
  photos: WorkEvidencePhoto[];
}

export function workEvidenceQueryKey(contractId: string): readonly ['work-evidence', string] {
  return ['work-evidence', contractId];
}

/** Short phrase used in the release-blocked sentence. */
export function proofOfWorkItemLabel(token: string): string {
  switch (token) {
    case WORK_EVIDENCE_MISSING.CHECK_IN:
      return 'check-in';
    case WORK_EVIDENCE_MISSING.AFTER_PHOTO:
      return 'an after photo';
    default:
      return token.replaceAll('_', ' ');
  }
}

/** Checklist label shown under the disabled release CTA. */
export function proofOfWorkMissingListLabel(token: string): string {
  switch (token) {
    case WORK_EVIDENCE_MISSING.CHECK_IN:
      return 'Check-in at the job site';
    case WORK_EVIDENCE_MISSING.AFTER_PHOTO:
      return 'After photo of completed work';
    default:
      return token.replaceAll('_', ' ');
  }
}

/**
 * Canonical blocked-release copy. Empty `missing` still names both
 * requirements so the customer never sees a success-shaped empty string.
 */
export function proofOfWorkBlockedMessage(missing: readonly string[]): string {
  const tokens = missing.length > 0 ? missing : [
    WORK_EVIDENCE_MISSING.CHECK_IN,
    WORK_EVIDENCE_MISSING.AFTER_PHOTO,
  ];
  const labels = tokens.map(proofOfWorkItemLabel);
  if (labels.length === 1) {
    return `Need ${labels[0] ?? 'proof of work'} before funds release`;
  }
  const last = labels[labels.length - 1] ?? 'proof of work';
  const head = labels.slice(0, -1).join(', ');
  return `Need ${head} and ${last} before funds release`;
}

/**
 * 409 proof-of-work body → missing tokens. `null` when the error is not a
 * proof-of-work conflict (caller should use the generic API message).
 */
export function parseProofOfWorkMissing(err: unknown): string[] | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  try {
    const parsed = JSON.parse(err.body) as { missing?: unknown; error?: unknown };
    const isProof =
      parsed.error === 'proof of work required' || Array.isArray(parsed.missing);
    if (!isProof) return null;
    if (!Array.isArray(parsed.missing)) return [];
    return parsed.missing.filter(
      (item): item is string => typeof item === 'string' && item.length > 0,
    );
  } catch {
    return [];
  }
}

export function useWorkEvidence(contractId: string) {
  return useQuery({
    queryKey: workEvidenceQueryKey(contractId),
    queryFn: () => api.get<WorkEvidence>(`/api/v1/contracts/${contractId}/work-evidence`),
    enabled: !!contractId,
  });
}
