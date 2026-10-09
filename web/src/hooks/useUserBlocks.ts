// User-block hooks — closes audit Section F. Wave 5 / Agent P.
//
// Block/unblock are idempotent on the server (UNIQUE (blocker_id,
// blocked_id) on conflict do nothing). Both mutations invalidate
// 'my-blocks' and 'channels' so the UI hides messages from a freshly
// blocked sender on the next render.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { UserBlocksResponse } from '@/types';

const MY_BLOCKS_KEY = ['my-blocks'] as const;

interface BlockInput {
  reason?: string;
}

export function useMyBlocks() {
  return useQuery<UserBlocksResponse>({
    queryKey: MY_BLOCKS_KEY,
    queryFn: () => api.get<UserBlocksResponse>('/api/v1/me/blocks'),
    staleTime: 60 * 1000,
  });
}

export function useBlockUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: { userId: string; reason?: string }) =>
      api.post<{ blocked: boolean; blocked_id: string }>(
        `/api/v1/users/${variables.userId}/block`,
        { reason: variables.reason ?? '' } satisfies BlockInput,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MY_BLOCKS_KEY });
      void queryClient.invalidateQueries({ queryKey: ['channels'] });
    },
  });
}

export function useUnblockUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) =>
      api.delete<{ blocked: boolean; blocked_id: string }>(
        `/api/v1/users/${userId}/block`,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MY_BLOCKS_KEY });
      void queryClient.invalidateQueries({ queryKey: ['channels'] });
    },
  });
}
