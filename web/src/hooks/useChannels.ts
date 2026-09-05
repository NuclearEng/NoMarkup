import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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
  /** FR-8.6: optional server inbox search (party names + last message). */
  q?: string;
}

interface MessagesParams {
  before?: string;
  page_size?: number;
  /** FR-8.6: optional membership-scoped content search within the channel. */
  q?: string;
  /** Override query enabled (default: !!channelId). Used to idle the search query. */
  enabled?: boolean;
}

export function useChannels(params?: ChannelsParams) {
  const searchParams = new URLSearchParams();
  if (params?.page !== undefined) searchParams.set('page', String(params.page));
  if (params?.per_page !== undefined) searchParams.set('per_page', String(params.per_page));
  // Gateway ListChannels reads page_size; send both so existing clients and
  // the live handler agree (gateway ignores unknown keys).
  if (params?.per_page !== undefined) searchParams.set('page_size', String(params.per_page));
  const trimmedQ = params?.q?.trim();
  if (trimmedQ) searchParams.set('q', trimmedQ.slice(0, 200));
  const query = searchParams.toString();
  const path = `/api/v1/channels${query ? `?${query}` : ''}`;

  return useQuery({
    queryKey: ['channels', params?.page, params?.per_page, trimmedQ || undefined],
    queryFn: () => api.get<ChannelsResponse>(path),
    // Keep prior inbox page while debounced search refetches / if search errors (local filter interim).
    placeholderData: keepPreviousData,
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
  const trimmedQ = params?.q?.trim();
  if (trimmedQ) searchParams.set('q', trimmedQ.slice(0, 200));
  const query = searchParams.toString();
  const path = `/api/v1/channels/${channelId}/messages${query ? `?${query}` : ''}`;

  return useQuery({
    queryKey: ['messages', channelId, params?.before, params?.page_size, trimmedQ || undefined],
    queryFn: () => api.get<MessagesResponse>(path),
    enabled: params?.enabled !== undefined ? params.enabled && !!channelId : !!channelId,
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

/** Body for POST …/proposed-terms (provider-only; server enforces party + role). */
export interface SendProposedTermsInput {
  payment_type: string;
  amount: string;
  milestones?: string;
  description?: string;
}

/**
 * POST `/api/v1/channels/{id}/proposed-terms` — provider proposes local terms.
 * Does not bind the contract; customer Accept/Reject is a separate call.
 * Server enforces provider-only + channel membership (never trust client role alone).
 */
export function useSendProposedTerms() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variables: { channelId: string; input: SendProposedTermsInput }) => {
      const raw = await api.post<Record<string, unknown>>(
        `/api/v1/channels/${variables.channelId}/proposed-terms`,
        {
          payment_type: variables.input.payment_type,
          amount: variables.input.amount,
          milestones: variables.input.milestones ?? '',
          description: variables.input.description ?? '',
        },
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

/**
 * POST `/api/v1/channels/{id}/terms/respond` — customer Accept/Reject of proposed terms.
 * Body: `{ accepted: true | false }` (required; gateway 400 if omitted — never default-accept).
 * Server enforces customer-only + channel membership.
 */
export function useRespondToTerms() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variables: { channelId: string; accepted: boolean }) => {
      const raw = await api.post<Record<string, unknown>>(
        `/api/v1/channels/${variables.channelId}/terms/respond`,
        { accepted: variables.accepted },
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

export function useUnreadCount() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  return useQuery({
    queryKey: ['unread-count'],
    queryFn: () => api.get<UnreadCountResponse>('/api/v1/channels/unread'),
    refetchInterval: 60000,
    enabled: isAuthenticated,
  });
}

/** Input for FR-8.1 POST /api/v1/channels (inquiry | bid | contract). */
export interface CreateChannelInput {
  job_id: string;
  /** Defaults server-side to "inquiry". Use "bid" when the provider already has an active bid. */
  channel_type?: 'inquiry' | 'bid' | 'contract';
}

/**
 * POST `/api/v1/channels` — FR-8.1 open a pre-bid inquiry or bid channel.
 * Caller must be a provider who is not the job owner (server-enforced).
 * Gateway returns `{ channel }` on 201.
 */
export function useCreateChannel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateChannelInput) => {
      const raw = await api.post<{ channel: Channel }>('/api/v1/channels', {
        job_id: input.job_id,
        channel_type: input.channel_type ?? 'inquiry',
      });
      return raw.channel;
    },
    onSuccess: (channel) => {
      void queryClient.invalidateQueries({ queryKey: ['channels'] });
      if (channel?.id) {
        void queryClient.invalidateQueries({ queryKey: ['channel', channel.id] });
      }
      void queryClient.invalidateQueries({ queryKey: ['unread-count'] });
    },
  });
}

/** Body for FR-8.8 POST …/share-contact — at least one of phone/email required. */
export interface ShareContactInput {
  phone?: string;
  email?: string;
}

export interface SharedContact {
  user_id: string;
  phone?: string;
  email?: string;
  shared_at?: string;
}

/**
 * POST `/api/v1/channels/{id}/share-contact` — FR-8.8 explicit opt-in contact share.
 * Does not relax auto contact-info filtering on free-text messages.
 * Server requires channel membership + at least one of phone/email.
 */
export function useShareContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variables: { channelId: string; input: ShareContactInput }) => {
      const phone = variables.input.phone?.trim() ?? '';
      const email = variables.input.email?.trim() ?? '';
      if (!phone && !email) {
        throw new Error('Phone or email is required');
      }
      const raw = await api.post<{ contact: SharedContact }>(
        `/api/v1/channels/${variables.channelId}/share-contact`,
        {
          ...(phone ? { phone } : {}),
          ...(email ? { email } : {}),
        },
      );
      return raw.contact;
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['messages', variables.channelId] });
      void queryClient.invalidateQueries({ queryKey: ['channels'] });
      void queryClient.invalidateQueries({ queryKey: ['channel', variables.channelId] });
    },
  });
}
