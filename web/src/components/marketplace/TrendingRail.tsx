'use client';

/**
 * TrendingRail — horizontal-scroll rail of the most active auctions right now.
 *
 * "Trending" is a server-side composite: bid count + unique bidders +
 * bid velocity (last hour). See gateway/internal/handler/listings.go's
 * `case "trending"` ORDER BY for the exact weights. We don't recompute it
 * client-side so the ordering is stable across all clients.
 *
 * Hide rules:
 *   - empty list  → render nothing (don't show an empty header)
 *   - error       → render nothing (this is a discovery enhancement, not load-bearing)
 *   - loading     → skeleton tiles (so the layout doesn't shift)
 */

import { Flame, Users } from 'lucide-react';
import Image from 'next/image';
import type { Route } from 'next';
import Link from 'next/link';

import { useTrendingListings } from '@/hooks/useListings';
import { canNextImageLoad, formatCents } from '@/lib/utils';
import type { Listing } from '@/types';

interface TrendingRailProps {
  className?: string;
  limit?: number;
}

export function TrendingRail({ className, limit = 12 }: TrendingRailProps) {
  const { data, isLoading, isError } = useTrendingListings(limit);

  if (isError) return null;

  const listings = (data?.listings ?? []) as Array<
    Listing & { watcher_count?: number }
  >;
  if (!isLoading && listings.length === 0) return null;

  return (
    <section
      aria-label="Trending now"
      className={`mb-6 ${className ?? ''}`}
      data-testid="trending-rail"
    >
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <div className="flex items-center gap-2">
          <Flame
            className="h-4 w-4 text-amber-300"
            aria-hidden="true"
          />
          <h2 className="text-sm font-semibold tracking-wide text-zinc-200 uppercase">
            Trending now
          </h2>
        </div>
        {/* zinc-400, not zinc-500: zinc-500 on the page bg (#070b14) is 4.07:1,
            under the 4.5:1 WCAG AA floor for small text (axe: color-contrast).
            zinc-400 is 7.68:1. */}
        <p className="text-xs text-zinc-400">
          Most-watched, most-bid in the last hour.
        </p>
      </header>

      <ul className="rail-scroll flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => (
              <li
                key={`trending-skeleton-${String(i)}`}
                className="glass animate-pulse w-44 shrink-0 snap-start rounded-lg border border-white/[0.06] p-2"
              >
                <div className="aspect-[4/3] w-full rounded-md bg-white/[0.06]" />
                <div className="mt-2 h-3 w-3/4 rounded bg-white/[0.06]" />
                <div className="mt-1 h-3 w-1/2 rounded bg-white/[0.06]" />
              </li>
            ))
          : listings.map((l) => <TrendingCard key={l.id} listing={l} />)}
      </ul>
    </section>
  );
}

function TrendingCard({
  listing,
}: {
  listing: Listing & { watcher_count?: number };
}) {
  const rawPhoto = listing.photos[0]?.url;
  // Only hand next/image a src it can actually optimize; an unconfigured
  // remote host throws and crashes the page, so fall back to the placeholder.
  const photo = canNextImageLoad(rawPhoto) ? rawPhoto : undefined;
  const watchers = listing.watcher_count ?? 0;
  return (
    <li className="w-44 shrink-0 snap-start" data-testid="trending-card">
      <Link
        href={(`/marketplace/${listing.id}`) as Route}
        className="glass glass-highlight group block overflow-hidden rounded-lg border border-white/[0.06] transition hover:border-amber-400/30"
      >
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-zinc-900">
          {photo ? (
            <Image
              src={photo}
              alt={listing.title}
              fill
              sizes="176px"
              className="object-cover transition group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-zinc-600">
              No photo
            </div>
          )}
        </div>
        <div className="space-y-1 p-2">
          <p className="line-clamp-2 text-xs text-zinc-200">{listing.title}</p>
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-[var(--brand-gold)] tabular-nums">
              {formatCents(listing.current_bid_cents)}
            </span>
            <span className="flex items-center gap-1 text-[10px] text-zinc-500">
              <Users className="h-3 w-3" aria-hidden="true" />
              <span className="tabular-nums">{String(watchers)}</span>
            </span>
          </div>
        </div>
      </Link>
    </li>
  );
}
