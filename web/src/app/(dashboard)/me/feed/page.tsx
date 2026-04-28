'use client';

// /me/feed — activity feed of followed sellers' active auctions.
//
// The retention surface flagged MISSING by the security audit (Section A:
// Whatnot's signature follow-graph mechanic). Renders one column of
// ListingCards sorted by auction_ends_at ASC so closing-soon items
// surface first. Empty state nudges the user toward the marketplace.

import Link from 'next/link';

import { ListingCard } from '@/components/marketplace/ListingCard';
import { Button } from '@/components/ui/button';
import { useMyFeed } from '@/hooks/useFollows';
import type { Listing } from '@/types';

export default function MyFeedPage() {
  const { data, isLoading, isError, refetch } = useMyFeed();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="gold-text text-2xl font-bold">Your feed</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Live auctions from sellers you follow, closing-soonest first.
          </p>
        </div>
        <Link
          href="/marketplace"
          className="text-sm text-[var(--brand-gold)] underline-offset-4 hover:underline"
        >
          Browse marketplace
        </Link>
      </header>

      {isLoading ? (
        <div className="space-y-4" aria-busy="true">
          <div className="glass glass-highlight h-48 animate-pulse rounded-xl border border-[var(--brand-gold)]/10" />
          <div className="glass glass-highlight h-48 animate-pulse rounded-xl border border-[var(--brand-gold)]/10" />
          <div className="glass glass-highlight h-48 animate-pulse rounded-xl border border-[var(--brand-gold)]/10" />
        </div>
      ) : null}

      {!isLoading && isError ? (
        <div
          role="alert"
          className="glass glass-highlight rounded-xl border border-red-500/20 p-6 text-center"
        >
          <p className="text-red-400">Failed to load your feed.</p>
          <Button
            variant="outline"
            className="mt-4 min-h-[44px] border-[var(--brand-gold)]/15 bg-white/[0.04] text-zinc-200 hover:bg-white/[0.08]"
            onClick={() => {
              void refetch();
            }}
          >
            Retry
          </Button>
        </div>
      ) : null}

      {!isLoading && !isError && (data?.listings.length ?? 0) === 0 ? (
        <EmptyFeedState />
      ) : null}

      {!isLoading && !isError && (data?.listings.length ?? 0) > 0 ? (
        <ul className="space-y-4">
          {data?.listings.map((listing: Listing) => (
            <li key={listing.id}>
              <ListingCard listing={listing} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function EmptyFeedState() {
  return (
    <div className="glass glass-highlight rounded-xl border border-[var(--brand-gold)]/10 p-10 text-center">
      <p className="text-base font-medium text-zinc-200">No activity yet</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-zinc-400">
        Follow sellers to see their auctions here. Browse the marketplace and tap the
        Follow button on any seller you trust.
      </p>
      <Button asChild className="mt-5 min-h-[44px]">
        <Link href="/marketplace">Browse marketplace</Link>
      </Button>
    </div>
  );
}
