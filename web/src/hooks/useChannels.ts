import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
  Channel,
  ChannelsResponse,
  ChatMessage,
  MessagesResponse,
  SendMessageInput,
  UnreadCountResponse,
} from '@/types';

interface ChannelsParams {
  page?: number;
  per_page?: number;
}

interface MessagesParams {
  before?: string;
  page_size?: number;
}

export function useChannels(params?: ChannelsParams) {
  const searchParams = new URLSearchParams();
  if (params?.page !== undefined) searchParams.set('page', String(params.page));
  if (params?.per_page !== undefined) searchParams.set('per_page', String(params.per_page));
  const query = searchParams.toString();
  const path = `/api/v1/channels${query ? `?${query}` : ''}`;

  return useQuery({
    queryKey: ['channels', params?.page, params?.per_page],
    queryFn: () => api.get<ChannelsResponse>(path),
  });
}

export function useChannel(id: string) {
  return useQuery({
    queryKey: ['channel', id],
    queryFn: () => api.get<{ channel: Channel }>(`/api/v1/channels/${id}`),
    enabled: !!id,
  });
}

export function useMessages(channelId: string, params?: MessagesParams) {
  const searchParams = new URLSearchParams();
  if (params?.before) searchParams.set('before', params.before);
  if (params?.page_size !== undefined) searchParams.set('page_size', String(params.page_size));
  const query = searchParams.toString();
  const path = `/api/v1/channels/${channelId}/messages${query ? `?${query}` : ''}`;

  return useQuery({
    queryKey: ['messages', channelId, params?.before, params?.page_size],
    queryFn: () => api.get<MessagesResponse>(path),
    enabled: !!channelId,
  });
}

export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: { channelId: string; input: SendMessageInput }) =>
      api
        .post<{ message: ChatMessage }>(`/api/v1/channels/${variables.channelId}/messages`, variables.input)
        .then((res) => res.message),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['messages', variables.channelId] });
      void queryClient.invalidateQueries({ queryKey: ['channels'] });
      void queryClient.invalidateQueries({ queryKey: ['channel', variables.channelId] });
      void queryClient.invalidateQueries({ queryKey: ['unread-count'] });
    },
  });
}

export function useMarkRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (channelId: string) =>
      api.post<{ success: boolean }>(`/api/v1/channels/${channelId}/read`),
    onSuccess: (_data, channelId) => {
      void queryClient.invalidateQueries({ queryKey: ['channels'] });
      void queryClient.invalidateQueries({ queryKey: ['channel', channelId] });
      void queryClient.invalidateQueries({ queryKey: ['unread-count'] });
    },
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ['unread-count'],
    queryFn: () => api.get<UnreadCountResponse>('/api/v1/channels/unread'),
    refetchInterval: 60000,
  });
}
