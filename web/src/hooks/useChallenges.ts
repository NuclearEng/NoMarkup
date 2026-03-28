import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
  AdminChallenge,
  Challenge,
  ChallengeDetail,
  CreateChallengeInput,
  MyChallengeProgress,
} from '@/types';

const challengeKeys = {
  all: ['challenges'] as const,
  active: () => [...challengeKeys.all, 'active'] as const,
  mine: () => [...challengeKeys.all, 'mine'] as const,
  detail: (id: string) => [...challengeKeys.all, 'detail', id] as const,
  admin: () => [...challengeKeys.all, 'admin'] as const,
};

export function useActiveChallenges() {
  return useQuery({
    queryKey: challengeKeys.active(),
    queryFn: () =>
      api
        .get<{ challenges: Challenge[] }>('/api/v1/challenges')
        .then((res) => res.challenges),
  });
}

export function useMyChallenges() {
  return useQuery({
    queryKey: challengeKeys.mine(),
    queryFn: () =>
      api
        .get<{ challenges: MyChallengeProgress[] }>('/api/v1/challenges/me')
        .then((res) => res.challenges),
  });
}

export function useChallenge(id: string) {
  return useQuery({
    queryKey: challengeKeys.detail(id),
    queryFn: () => api.get<ChallengeDetail>(`/api/v1/challenges/${id}`),
    enabled: id !== '',
  });
}

export function useJoinChallenge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (challengeId: string) =>
      api.post<{ participant_id: string; challenge_id: string; joined: boolean }>(
        `/api/v1/challenges/${challengeId}/join`,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: challengeKeys.all });
    },
  });
}

// Admin hooks

export function useAdminChallenges() {
  return useQuery({
    queryKey: challengeKeys.admin(),
    queryFn: () =>
      api
        .get<{ challenges: AdminChallenge[] }>('/api/v1/admin/challenges')
        .then((res) => res.challenges),
  });
}

export function useCreateChallenge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateChallengeInput) =>
      api.post<AdminChallenge>('/api/v1/admin/challenges', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: challengeKeys.all });
    },
  });
}
