'use client';

import { Gavel, Heart, MapPin } from 'lucide-react';
import Link from 'next/link';
import type { Route } from 'next';
import type { MouseEvent } from 'react';

import { CountdownClock } from '@/components/marketplace/CountdownClock';
import { WatcherBadge } from '@/components/marketplace/WatcherBadge';
import { useWatchListing } from '@/hooks/useWatchlist';
import { formatCents } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type { Listing } from '@/types';

// StockX-style condition labels + per-grade chip styling. Like-new uses
// the brand emerald, "new" uses brand gold so it pops against the
// scoreboard glow; the rest fall back to a neutral zinc treatment so
// the card doesn't turn into a rainbow of badges.
const CONDITION_LABELS: Record<NonNullable<Listing['condition']>, string> = {
  new: 'New',
  like_new: 'Like new',
  very_good: 'Very good',
  good: 'Good',
  acceptable: 'Acceptable',
  for_parts: 'For parts',
};

const CONDITION_CLASSES: Record<NonNullable<Listing['condition']>, string> = {
  new: 'border-[var(--brand-gold)]/40 bg-[var(--brand-gold)]/15 text-[var(--brand-gold)]',
  like_new: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  very_good: 'border-zinc-600 bg-zinc-700/40 text-zinc-200',
  good: 'border-zinc-600 bg-zinc-700/40 text-zinc-300',
  acceptable: 'border-zinc-600 bg-zinc-700/40 text-zinc-300',
  for_parts: 'border-zinc-600 bg-zinc-700/40 text-zinc-300',
};

interface ScoreboardCardProps {
  listing: Listing & { watcher_count?: number };
  /**
   * Visual urgency band — drives border color, glow, and accent treatment.
   *
   * - `critical` for auctions ending in <10 min (red glow)
   * - `urgent`   for 10–60 min (gold)
   * - `normal`   for the rest (zinc, no glow)
   */
  urgency?: 'critical' | 'urgent' | 'normal';
  /**
   * Whether the signed-in user is watching this listing. Parent hydrates
   * from `useWatchlist().data` and passes it down so we don't trigger one
   * mutation per card.
   */
  watching?: boolean;
}

/**
 * Live-auction broadcast card. Mirrors a sports-scoreboard tile rather than
 * a Pinterest-style product cell. The countdown ticks in real time, the
 * watcher count is visible, and the styling escalates with urgency so the
 * scoreboard reads like ESPN GameDay rather than a category catalog.
 */
export function ScoreboardCard({ listing, urgency = 'normal', watching = false }: ScoreboardCardProps) {
  const photo = listing.photos?.[0]?.url ?? null;
  const location =
    listing.pickup_city && listing.pickup_state
      ? `${listing.pickup_city}, ${listing.pickup_state}`
      : listing.pickup_zip;

  const watchMutation = useWatchListing(listing.id);
  const onHeartClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    watchMutation.mutate({ watching: !watching });
  };

  const borderClass =
    urgency === 'critical'
      ? 'border-red-500/50 shadow-[0_0_30px_rgba(239,68,68,0.18)] hover:shadow-[0_0_40px_rgba(239,68,68,0.32)]'
      : urgency === 'urgent'
        ? 'border-[var(--brand-gold)]/40 shadow-[0_0_24px_rgba(212,175,55,0.16)] hover:shadow-[0_0_36px_rgba(212,175,55,0.28)]'
        : 'border-[var(--brand-gold)]/10 hover:border-[var(--brand-gold)]/25';

  return (
    <Link
      href={`/marketplace/${listing.id}` as Route}
      className={cn(
        'glass glass-highlight group relative flex flex-col overflow-hidden rounded-xl border transition-all duration-200',
        borderClass,
      )}
      aria-label={`${listing.title}, current bid ${formatCents(listing.current_bid_cents)}, ${String(listing.bid_count)} bids`}
    >
      {/* Hero image */}
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-white/[0.04]">
        {photo ? (
          <img
            src={photo}
            alt={listing.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-zinc-700">
            <Gavel className="h-10 w-10" aria-hidden="true" />
          </div>
        )}

        {/* Live ribbon */}
        {urgency !== 'normal' ? (
          <span
            className={cn(
              'absolute top-2 left-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase',
              urgency === 'critical'
                ? 'bg-red-500 text-white'
                : 'bg-[var(--brand-gold)] text-black',
            )}
          >
            <span className="relative flex h-2 w-2">
              <span
                className={cn(
                  'absolute inline-flex h-full w-full animate-ping rounded-full opacity-75',
                  urgency === 'critical' ? 'bg-red-300' : 'bg-amber-700',
                )}
              />
              <span
                className={cn(
                  'relative inline-flex h-2 w-2 rounded-full',
                  urgency === 'critical' ? 'bg-red-200' : 'bg-amber-800',
                )}
              />
            </span>
            {urgency === 'critical' ? 'Ending now' : 'Closing soon'}
          </span>
        ) : null}

        {/* Snipe-extension badge */}
        {listing.snipe_extension_count > 0 ? (
          <span className="absolute top-2 right-12 inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
            +30s ×{listing.snipe_extension_count}
          </span>
        ) : null}

        {/* Watch heart — top-right corner. Stops propagation so clicking the
            heart doesn't navigate into the listing. */}
        <button
          type="button"
          onClick={onHeartClick}
          disabled={watchMutation.isPending}
          aria-pressed={watching}
          aria-label={watching ? 'Remove from watchlist' : 'Add to watchlist'}
          className={cn(
            'absolute top-2 right-2 inline-flex h-9 w-9 items-center justify-center rounded-full border backdrop-blur-md transition-colors',
            watching
              ? 'border-red-400/50 bg-red-500/20 text-red-300 hover:bg-red-500/30'
              : 'border-white/10 bg-black/30 text-white/80 hover:border-white/30 hover:text-white',
            watchMutation.isPending ? 'opacity-60' : '',
          )}
        >
          <Heart className={cn('h-4 w-4', watching ? 'fill-current' : '')} aria-hidden="true" />
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="line-clamp-2 text-base font-semibold text-zinc-100 group-hover:text-[var(--brand-gold)]">
            {listing.title}
          </h3>
          <WatcherBadge count={listing.watcher_count ?? 0} />
        </div>

        <div className="flex items-baseline justify-between">
          <div>
            <p className="text-[11px] tracking-wider text-zinc-500 uppercase">Current bid</p>
            <p className="text-2xl font-bold tabular-nums text-zinc-100">
              {formatCents(listing.current_bid_cents)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] tracking-wider text-zinc-500 uppercase">Closes in</p>
            <CountdownClock endsAt={listing.auction_ends_at} />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-white/5 pt-3 text-xs text-zinc-400">
          <div className="flex items-center gap-2 truncate">
            <span className="inline-flex shrink-0 items-center gap-1">
              <Gavel className="h-3 w-3" aria-hidden="true" />
              {listing.bid_count} {listing.bid_count === 1 ? 'bid' : 'bids'}
            </span>
            {listing.condition ? (
              <span
                className={cn(
                  'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase',
                  CONDITION_CLASSES[listing.condition],
                )}
                aria-label={`Condition: ${CONDITION_LABELS[listing.condition]}`}
              >
                {CONDITION_LABELS[listing.condition]}
              </span>
            ) : null}
          </div>
          <span className="inline-flex items-center gap-1 truncate">
            <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{location}</span>
          </span>
        </div>
      </div>
    </Link>
  );
}
