// Quick-reply chat templates — closes audit Section F. Wave 5 / Agent P.
//
// The list endpoint returns the user's templates AND a built-in default
// list. The composer can render either rail; here we surface both. The
// `use` mutation bumps use_count so most-used templates float up.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { MessageTemplate, MessageTemplatesResponse } from '@/types';

const TEMPLATES_KEY = ['chat-templates'] as const;

interface CreateTemplateInput {
  body: string;
}

interface UpdateTemplateInput {
  id: string;
  body: string;
}

export function useChatTemplates() {
  return useQuery<MessageTemplatesResponse>({
    queryKey: TEMPLATES_KEY,
    queryFn: () =>
      api.get<MessageTemplatesResponse>('/api/v1/me/chat/templates'),
    staleTime: 60 * 1000,
  });
}

export function useCreateChatTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateTemplateInput) =>
      api.post<MessageTemplate>('/api/v1/me/chat/templates', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY });
    },
  });
}

export function useUpdateChatTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateTemplateInput) =>
      api.patch<MessageTemplate>(`/api/v1/me/chat/templates/${input.id}`, {
        body: input.body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY });
    },
  });
}

export function useDeleteChatTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      api.delete<unknown>(`/api/v1/me/chat/templates/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY });
    },
  });
}

export function useUseChatTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ id: string; use_count: number }>(
        `/api/v1/me/chat/templates/${id}/use`,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY });
    },
  });
}
