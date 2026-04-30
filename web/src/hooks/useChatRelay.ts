// Chat relay hooks — anonymous email/phone proxy aliases. Closes audit
// Section F (Craigslist-style relay). Wave 5 / Agent P.
//
// In dev neither the inbound mail forwarder nor Twilio Proxy is wired up;
// the gateway returns alias-{nanoid}@relay.nomarkup.com and a NULL phone.
// The UI hides the "call" affordance when twilio_proxy_phone is null.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
  ChatAlias,
  ChatAliasesResponse,
  CreateChatAliasInput,
} from '@/types';

const ALIASES_KEY = ['chat-aliases'] as const;

export function useChatAliases() {
  return useQuery<ChatAliasesResponse>({
    queryKey: ALIASES_KEY,
    queryFn: () => api.get<ChatAliasesResponse>('/api/v1/me/chat/aliases'),
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateChatAlias() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateChatAliasInput) =>
      api.post<ChatAlias>('/api/v1/me/chat/aliases', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ALIASES_KEY });
    },
  });
}
