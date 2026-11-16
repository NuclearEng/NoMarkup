// Wishlist + price alerts — the buyer's "dream item" loop.
//
// Pairs with the gateway handler at gateway/internal/handler/wishlist.go.
// Mirrors the patterns in useWatchlist.ts (TanStack Query, sonner toasts,
// ApiError unwrapping). When a new marketplace listing goes active and matches
// a wishlist item (keyword in title, price <= max_price_cents, optional
// category), the gateway writes a notification that surfaces via the bell.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError, api } from '@/lib/api';

function explainWishlistFailure(fallback: string): (err: unknown) => void {
  return (err: unknown) => {
    if (err instanceof ApiError) {
      toast.error(err.userMessage(fallback));
      return;
    }
    toast.error(fallback);
  };
}

export interface WishlistItem {
  id: string;
  user_id: string;
  keyword: string;
  category_id: string | null;
  category_name: string | null;
  max_price_cents: number;
  created_at: string;
}

export interface WishlistResponse {
  wishlist_items: WishlistItem[];
}

export interface CreateWishlistItemInput {
  keyword: string;
  /** Integer cents — "notify me if available at or below this price." */
  max_price_cents: number;
  /** Optional category narrowing (slug or UUID). */
  category_id?: string;
}

/**
 * The signed-in user's wishlist items. Auth-only; the endpoint 401s for
 * logged-out visitors, so callers on public surfaces should pass
 * `{ enabled: false }`.
 */
export function useWishlist(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['wishlist'],
    queryFn: () => api.get<WishlistResponse>('/api/v1/me/wishlist'),
    enabled: options?.enabled ?? true,
  });
}

export function useCreateWishlistItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWishlistItemInput) =>
      api.post<{ wishlist_item: WishlistItem }>('/api/v1/me/wishlist', {
        keyword: input.keyword,
        max_price_cents: input.max_price_cents,
        ...(input.category_id ? { category_id: input.category_id } : {}),
      }),
    onSuccess: () => {
      toast.success('Added to wishlist — we’ll alert you when a match goes live');
      void qc.invalidateQueries({ queryKey: ['wishlist'] });
    },
    onError: explainWishlistFailure('Failed to add to wishlist'),
  });
}

export function useDeleteWishlistItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<Record<string, never>>(`/api/v1/me/wishlist/${id}`),
    onSuccess: () => {
      toast.success('Removed from wishlist');
      void qc.invalidateQueries({ queryKey: ['wishlist'] });
    },
    onError: explainWishlistFailure('Failed to remove wishlist item'),
  });
}
