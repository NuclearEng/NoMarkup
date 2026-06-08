'use client';

/**
 * RecentlyViewed — horizontal rail of the last 6 listings the user opened
 * during this browser's lifetime. Backed by localStorage via the
 * `useRecentlyViewedListings` hook; hidden when the user hasn't opened
 * anything yet (so first-time visitors don't see an empty bar).
 *
 * Why client-side only: this is a personal navigation aid, not behavioral
 * data we want to mirror server-side. localStorage is enough and avoids
 * a new authenticated API surface.
 */

import { Clock, History } from 'lucide-react';
import Image from 'next/image';
import type { Route } from 'next';
import Link from 'next/link';

import { useRecentlyViewedListings } from '@/hooks/useRecentlyViewed';
import { canNextImageLoad, formatCents } from '@/lib/utils';
import type { ListingDetail } from '@/types';

interface RecentlyViewedProps {
  className?: string;
  limit?: number;
}

export function RecentlyViewed({ className, limit = 6 }: RecentlyViewedProps) {
  const { listings, isLoading } = useRecentlyViewedListings(limit);

  // Hide entirely when no IDs are stored yet OR the API failed for all of
  // them. We don't surface a skeleton when there's nothing in storage —
  // that would imply data is coming when it isn't.
  if (!isLoading && listings.length === 0) return null;

  return (
    <section
      aria-label="Recently viewed"
      className={`mt-10 ${className ?? ''}`}
      data-testid="recently-viewed"
    >
      <header className="mb-3 flex items-center gap-2">
        <History
          className="h-4 w-4 text-zinc-400"
          aria-hidden="true"
        />
        <h2 className="text-sm font-semibold tracking-wide text-zinc-200 uppercase">
          Recently viewed
        </h2>
      </header>

      <ul className="rail-scroll flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
        {listings.map((l) => (
          <RecentlyViewedCard key={l.id} listing={l} />
        ))}
      </ul>
    </section>
  );
}

function RecentlyViewedCard({ listing }: { listing: ListingDetail }) {
  const rawPhoto = listing.photos?.[0]?.url;
  // Only hand next/image a src it can actually optimize; an unconfigured
  // remote host throws and crashes the page, so fall back to the placeholder.
  const photo = canNextImageLoad(rawPhoto) ? rawPhoto : undefined;
  const endsAt = listing.auction_ends_at;
  return (
    <li className="w-44 shrink-0 snap-start" data-testid="recently-viewed-card">
      <Link
        href={(`/marketplace/${listing.id}`) as Route}
        className="glass glass-highlight group block overflow-hidden rounded-lg border border-white/[0.06] transition hover:border-[var(--brand-gold)]/30"
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
            {endsAt ? (
              <span className="flex items-center gap-1 text-[10px] text-zinc-500">
                <Clock className="h-3 w-3" aria-hidden="true" />
                <RelativeEnd endsAt={endsAt} />
              </span>
            ) : null}
          </div>
        </div>
      </Link>
    </li>
  );
}

function RelativeEnd({ endsAt }: { endsAt: string }) {
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return <>Ended</>;
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return <>{String(mins)}m left</>;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return <>{String(hours)}h left</>;
  const days = Math.floor(hours / 24);
  return <>{String(days)}d left</>;
}
