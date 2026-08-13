import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  parseProofOfWorkMissing,
  proofOfWorkBlockedMessage,
  proofOfWorkItemLabel,
  proofOfWorkMissingListLabel,
  useWorkEvidence,
  type WorkEvidence,
} from '@/hooks/useWorkEvidence';

vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    status: number;
    body: string;
    constructor(status: number, body: string) {
      super(`API error ${String(status)}: ${body}`);
      this.name = 'ApiError';
      this.status = status;
      this.body = body;
    }
    userMessage(fallback: string) {
      return this.message || fallback;
    }
  }
  return {
    api: {
      get: vi.fn(),
    },
    ApiError,
  };
});

const { api, ApiError } = await import('@/lib/api');

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const notReady: WorkEvidence = {
  ready_for_release: false,
  missing: ['check_in', 'after_photo'],
  sessions: [],
  photos: [],
};

describe('proof-of-work copy', () => {
  it('labels known missing tokens', () => {
    expect(proofOfWorkItemLabel('check_in')).toBe('check-in');
    expect(proofOfWorkItemLabel('after_photo')).toBe('an after photo');
    expect(proofOfWorkMissingListLabel('check_in')).toBe('Check-in at the job site');
    expect(proofOfWorkMissingListLabel('after_photo')).toBe('After photo of completed work');
  });

  it('builds the canonical blocked sentence for both items', () => {
    expect(proofOfWorkBlockedMessage(['check_in', 'after_photo'])).toBe(
      'Need check-in and an after photo before funds release',
    );
  });

  it('names a single missing item', () => {
    expect(proofOfWorkBlockedMessage(['after_photo'])).toBe(
      'Need an after photo before funds release',
    );
  });

  it('falls back to both requirements when missing is empty', () => {
    expect(proofOfWorkBlockedMessage([])).toBe(
      'Need check-in and an after photo before funds release',
    );
  });
});

describe('parseProofOfWorkMissing', () => {
  it('returns tokens from a 409 proof-of-work body', () => {
    const err = new ApiError(
      409,
      JSON.stringify({ error: 'proof of work required', missing: ['check_in'] }),
    );
    expect(parseProofOfWorkMissing(err)).toEqual(['check_in']);
  });

  it('returns empty tokens when 409 proof-of-work omits missing', () => {
    const err = new ApiError(409, JSON.stringify({ error: 'proof of work required' }));
    expect(parseProofOfWorkMissing(err)).toEqual([]);
  });

  it('returns null for non-409 errors', () => {
    const err = new ApiError(500, JSON.stringify({ error: 'boom' }));
    expect(parseProofOfWorkMissing(err)).toBeNull();
  });

  it('returns null for a 409 that is not proof-of-work', () => {
    const err = new ApiError(409, JSON.stringify({ error: 'already released' }));
    expect(parseProofOfWorkMissing(err)).toBeNull();
  });
});

describe('useWorkEvidence', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches work-evidence for a contract', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(notReady);

    const { result } = renderHook(() => useWorkEvidence('c-1'), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.ready_for_release).toBe(false);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/contracts/c-1/work-evidence');
  });

  it('does not fetch when contract id is empty', () => {
    const { result } = renderHook(() => useWorkEvidence(''), {
      wrapper: createWrapper(queryClient),
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });
});
