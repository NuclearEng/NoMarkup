// useWorkEvidence — unknown missing-proof tokens, three-item sentences, and
// the malformed-409-body paths of parseProofOfWorkMissing.
import { describe, expect, it, vi } from 'vitest';

import {
  parseProofOfWorkMissing,
  proofOfWorkBlockedMessage,
  proofOfWorkItemLabel,
  proofOfWorkMissingListLabel,
  workEvidenceQueryKey,
} from '@/hooks/useWorkEvidence';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { get: vi.fn() } };
});

const { ApiError } = await import('@/lib/api');

describe('proof-of-work labels for tokens the client does not know', () => {
  it('shows the raw token with underscores as spaces', () => {
    expect(proofOfWorkItemLabel('before_photo_set')).toBe('before photo set');
    expect(proofOfWorkMissingListLabel('before_photo_set')).toBe('before photo set');
  });

  it('uses different copy for the sentence and the checklist for a known token', () => {
    expect(proofOfWorkItemLabel('after_photo')).toBe('an after photo');
    expect(proofOfWorkMissingListLabel('after_photo')).toBe('After photo of completed work');
    expect(proofOfWorkMissingListLabel('check_in')).toBe('Check-in at the job site');
  });
});

describe('proofOfWorkBlockedMessage', () => {
  it('names a single unknown requirement', () => {
    expect(proofOfWorkBlockedMessage(['signed_waiver'])).toBe(
      'Need signed waiver before funds release',
    );
  });

  it('joins three requirements with commas and a final "and"', () => {
    expect(proofOfWorkBlockedMessage(['check_in', 'signed_waiver', 'after_photo'])).toBe(
      'Need check-in, signed waiver and an after photo before funds release',
    );
  });
});

describe('parseProofOfWorkMissing', () => {
  it('drops non-string and empty entries from `missing`', () => {
    const err = new ApiError(
      409,
      JSON.stringify({ error: 'proof of work required', missing: ['check_in', '', 7, null, 'after_photo'] }),
    );
    expect(parseProofOfWorkMissing(err)).toEqual(['check_in', 'after_photo']);
  });

  it('recognises a proof-of-work conflict by `missing` alone', () => {
    const err = new ApiError(409, JSON.stringify({ error: 'conflict', missing: ['check_in'] }));
    expect(parseProofOfWorkMissing(err)).toEqual(['check_in']);
  });

  it('treats a 409 whose body is not JSON as a proof-of-work block with no detail', () => {
    expect(parseProofOfWorkMissing(new ApiError(409, '<html>Conflict</html>'))).toEqual([]);
  });

  it('returns null for errors that are not ApiErrors', () => {
    expect(parseProofOfWorkMissing(new Error('proof of work required'))).toBeNull();
    expect(parseProofOfWorkMissing(undefined)).toBeNull();
  });
});

describe('workEvidenceQueryKey', () => {
  it('is ["work-evidence", contractId]', () => {
    expect(workEvidenceQueryKey('c-1')).toEqual(['work-evidence', 'c-1']);
  });
});
