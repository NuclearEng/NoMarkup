import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useActiveChallenges,
  useAdminChallenges,
  useChallenge,
  useCreateChallenge,
  useJoinChallenge,
  useMyChallenges,
} from '@/hooks/useChallenges';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    getPublic: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    code = 'ERR';
    userMessage(fallback: string) { return this.message || fallback; }
  },
}));

const { api } = await import('@/lib/api');

function qc(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}
function wrap(client: QueryClient) {
  return function W({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

describe('useActiveChallenges', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('unwraps challenges array from response', async () => {
    const challenges = [{ id: 'c-1', name: 'Top earner' }];
    vi.mocked(api.get).mockResolvedValueOnce({ challenges });

    const { result } = renderHook(() => useActiveChallenges(), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data).toEqual(challenges);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/challenges');
  });
});

describe('useMyChallenges', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('unwraps the per-user progress array', async () => {
    const progress = [{ challenge_id: 'c-1', progress: 50 }];
    vi.mocked(api.get).mockResolvedValueOnce({ challenges: progress });

    const { result } = renderHook(() => useMyChallenges(), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data).toEqual(progress);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/challenges/me');
  });
});

describe('useChallenge', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('fetches a single challenge detail', async () => {
    const detail = { id: 'c-1', name: 'Top earner', leaderboard: [] };
    vi.mocked(api.get).mockResolvedValueOnce(detail);

    const { result } = renderHook(() => useChallenge('c-1'), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data).toEqual(detail);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/challenges/c-1');
  });

  it('does not fetch with empty id', () => {
    const { result } = renderHook(() => useChallenge(''), { wrapper: wrap(client) });
    expect(result.current.fetchStatus).toBe('idle');
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });
});

describe('useJoinChallenge', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('posts join (no body) and invalidates the all-challenges key', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ participant_id: 'p-1', challenge_id: 'c-1', joined: true });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useJoinChallenge(), { wrapper: wrap(client) });
    result.current.mutate('c-1');
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/challenges/c-1/join');
    expect(result.current.data?.joined).toBe(true);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['challenges'] });
  });
});

describe('useAdminChallenges', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('unwraps admin challenges array', async () => {
    const challenges = [{ id: 'c-1', name: 'X', participant_count: 0 }];
    vi.mocked(api.get).mockResolvedValueOnce({ challenges });

    const { result } = renderHook(() => useAdminChallenges(), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data).toEqual(challenges);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/admin/challenges');
  });
});

describe('useCreateChallenge', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('posts the challenge payload + invalidates the all-challenges key', async () => {
    const created = { id: 'c-2', name: 'Speed run' };
    const input = {
      title: 'Speed run',
      description: 'win 5 jobs in a week',
      challenge_type: 'jobs_completed' as const,
      target_value: 5,
      reward_type: 'badge' as const,
      reward_value: 'speedster',
      starts_at: '2026-05-01',
      ends_at: '2026-05-08',
      is_seasonal: false,
    };
    vi.mocked(api.post).mockResolvedValueOnce(created);
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useCreateChallenge(), { wrapper: wrap(client) });
    result.current.mutate(input);
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/admin/challenges', input);
    expect(result.current.data).toEqual(created);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['challenges'] });
  });
});
