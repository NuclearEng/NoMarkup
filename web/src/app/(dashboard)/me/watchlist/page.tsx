'use client';

// /me/watchlist — the signed-in user's watched auctions.
//
// The watchlist hook (useWatchlist) had ZERO consumers before this page; the
// only watch UI was the heart on the browse grid. This surfaces the saved
// items as their own scoreboard grid so a user can review everything they're
// tracking and unwatch from one place. (Bug 1b)
//
// Each card reuses ScoreboardCard with watching={true}, so the heart renders
// "filled" and a click fires the unwatch mutation + (via query invalidation)
// drops the card from this list. Loading / error / empty are all handled.

import { Heart, Package } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';

import { ScoreboardCard } from '@/components/marketplace/ScoreboardCard';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useWatchlist } from '@/hooks/useWatchlist';
import type { Listing } from '@/types';

export default function WatchlistPage() {
  const { data, isLoading, isError, refetch } = useWatchlist();

  // Defensive: the API can return photo-less listings as `photos: null`,
  // which ScoreboardCard's `listing.photos?.[0]` tolerates, but we keep the
  // typed array contract here for clarity.
  const listings = useMemo(
    () => (data?.listings ?? []) as Array<Listing & { watcher_count?: number }>,
    [data],
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="gold-text text-2xl font-bold">Your watchlist</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Auctions you're tracking. Tap the heart on a card to stop watching.
          </p>
        </div>
        <Link
          href="/marketplace"
          className="shrink-0 text-sm text-[var(--brand-gold)] underline-offset-4 hover:underline"
        >
          Browse marketplace
        </Link>
      </header>

      {isLoading ? (
        <div
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
          aria-busy="true"
          aria-live="polite"
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={`watchlist-skeleton-${String(i)}`}
              className="glass glass-highlight animate-pulse rounded-xl border border-[var(--brand-gold)]/10 p-5"
            >
              <div className="mb-3 aspect-[16/10] w-full rounded-lg bg-white/[0.06]" />
              <div className="mb-2 h-5 w-3/4 rounded bg-white/[0.06]" />
              <div className="mb-4 h-3 w-5/6 rounded bg-white/[0.06]" />
              <div className="flex items-center justify-between">
                <div className="h-7 w-24 rounded bg-white/[0.06]" />
                <div className="h-5 w-16 rounded bg-white/[0.06]" />
              </div>
            </div>
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          icon={<Package className="h-8 w-8" aria-hidden="true" />}
          title="Failed to load your watchlist"
          description="Something went wrong while fetching your watched auctions. Check your connection and try again."
          action={
            <Button
              variant="default"
              className="min-h-[44px]"
              onClick={() => {
                void refetch();
              }}
            >
              Retry
            </Button>
          }
          className="border-destructive/30"
        />
      ) : listings.length === 0 ? (
        <EmptyState
          icon={<Heart className="h-8 w-8" aria-hidden="true" />}
          title="Nothing on your watchlist yet"
          description="Tap the heart on any auction to track it. Watched auctions show up here so you can jump back in before the gavel."
          action={
            <Button asChild className="min-h-[44px]">
              <Link href="/marketplace">Browse marketplace</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {listings.map((listing) => (
            <ScoreboardCard key={listing.id} listing={listing} watching />
          ))}
        </div>
      )}
    </div>
  );
}
