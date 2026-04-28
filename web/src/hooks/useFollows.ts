// Followable-seller hooks — pairs with the gateway handler at
// gateway/internal/handler/follows.go (mounted under /api/v1).
//
// The audit (Section A) flagged "follow seller" as the missing Whatnot
// retention mechanic. These hooks surface:
//
//   - useFollow(sellerId)         — toggle follow/unfollow with optimistic UI
//   - useFollowers(sellerId)      — public follower list (paginated)
//   - useMyFollows()              — sellers the signed-in user follows
//   - useMyFeed(page?)            — activity feed of followed sellers' active auctions
//
// Mirrors useWatchlist.ts in shape: TanStack Query, sonner toasts, ApiError
// unwrapping. The follow toggle invalidates everything that displays a
// follow state so the heart-style icon stays in sync everywhere.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError, api } from '@/lib/api';
import type { MyListingsResponse, PaginationResponse } from '@/types';

function explainFollowFailure(fallback: string): (err: unknown) => void {
  return (err: unknown) => {
    if (err instanceof ApiError) {
      toast.error(err.userMessage(fallback));
      return;
    }
    toast.error(fallback);
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

export interface FollowToggleResponse {
  following: boolean;
  follower_count?: number;
}

export interface Follower {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  followed_at: string;
}

export interface FollowersResponse {
  followers: Follower[];
  pagination: PaginationResponse;
}

export interface FollowedSeller {
  seller_id: string;
  display_name: string;
  avatar_url: string | null;
  followed_at: string;
}

export interface MyFollowsResponse {
  follows: FollowedSeller[];
  pagination: PaginationResponse;
}

// ─────────────────────────────────────────────────────────────────────────
// useFollow — toggle follow/unfollow on a seller
// ─────────────────────────────────────────────────────────────────────────

/**
 * Toggle follow state. Server-side is idempotent (UNIQUE on follower+seller);
 * the `following` parameter chooses POST vs DELETE. Invalidates the related
 * queries so the FollowButton stays in sync with /me/follows + the seller
 * profile's follower count.
 */
export function useFollow(sellerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ following }: { following: boolean }) => {
      if (following) {
        return api.post<FollowToggleResponse>(`/api/v1/users/${sellerId}/follow`);
      }
      return api.delete<FollowToggleResponse>(`/api/v1/users/${sellerId}/follow`);
    },
    onSuccess: (_data, variables) => {
      if (variables.following) {
        toast.success('Following — you\'ll see new auctions in your feed');
      } else {
        toast.success('Unfollowed');
      }
      void qc.invalidateQueries({ queryKey: ['follows'] });
      void qc.invalidateQueries({ queryKey: ['followers', sellerId] });
      void qc.invalidateQueries({ queryKey: ['feed'] });
    },
    onError: explainFollowFailure('Failed to update follow status'),
  });
}

// ─────────────────────────────────────────────────────────────────────────
// useFollowers — public list of followers for a seller
// ─────────────────────────────────────────────────────────────────────────

/** Paginated public list of followers for any user. */
export function useFollowers(sellerId: string, page?: number) {
  const sp = new URLSearchParams();
  if (page !== undefined) sp.set('page', String(page));
  const qs = sp.toString();
  const path = `/api/v1/users/${sellerId}/followers${qs ? `?${qs}` : ''}`;
  return useQuery({
    queryKey: ['followers', sellerId, page ?? 1],
    queryFn: () => api.get<FollowersResponse>(path),
    enabled: Boolean(sellerId),
  });
}

// ─────────────────────────────────────────────────────────────────────────
// useMyFollows — the signed-in user's followed sellers
// ─────────────────────────────────────────────────────────────────────────

/** Sellers the current user follows. Auth-required. */
export function useMyFollows(page?: number) {
  const sp = new URLSearchParams();
  if (page !== undefined) sp.set('page', String(page));
  const qs = sp.toString();
  const path = `/api/v1/me/follows${qs ? `?${qs}` : ''}`;
  return useQuery({
    queryKey: ['follows', page ?? 1],
    queryFn: () => api.get<MyFollowsResponse>(path),
  });
}

// ─────────────────────────────────────────────────────────────────────────
// useMyFeed — activity feed of followed sellers' active listings
// ─────────────────────────────────────────────────────────────────────────

/**
 * Activity feed: active listings from followed sellers, sorted by
 * auction_ends_at ASC (closing soonest first). The retention surface —
 * opening the app surfaces what your followed sellers are auctioning now.
 */
export function useMyFeed(page?: number) {
  const sp = new URLSearchParams();
  if (page !== undefined) sp.set('page', String(page));
  const qs = sp.toString();
  const path = `/api/v1/me/feed${qs ? `?${qs}` : ''}`;
  return useQuery({
    queryKey: ['feed', page ?? 1],
    queryFn: () => api.get<MyListingsResponse>(path),
  });
}
