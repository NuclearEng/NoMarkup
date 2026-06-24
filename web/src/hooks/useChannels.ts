import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
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
    // Gateway returns the channel at the top level — wrap to preserve consumer shape.
    queryFn: async () => {
      const raw = await api.get<Channel>(`/api/v1/channels/${id}`);
      return { channel: raw };
    },
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
    // Gateway returns the message at the top level (not wrapped in { message }).
    mutationFn: async (variables: { channelId: string; input: SendMessageInput }) => {
      const raw = await api.post<Record<string, unknown>>(
        `/api/v1/channels/${variables.channelId}/messages`,
        variables.input,
      );
      return raw as unknown as ChatMessage;
    },
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
    // Gateway returns { status: "ok" } — type the actual shape to avoid undefined.success.
    mutationFn: (channelId: string) =>
      api.post<{ status: string }>(`/api/v1/channels/${channelId}/read`),
    onSuccess: (_data, channelId) => {
      void queryClient.invalidateQueries({ queryKey: ['channels'] });
      void queryClient.invalidateQueries({ queryKey: ['channel', channelId] });
      void queryClient.invalidateQueries({ queryKey: ['unread-count'] });
    },
  });
}

export function useUnreadCount() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  return useQuery({
    queryKey: ['unread-count'],
    queryFn: () => api.get<UnreadCountResponse>('/api/v1/channels/unread'),
    refetchInterval: 60000,
    enabled: isAuthenticated,
  });
}
