'use client';

/**
 * SimilarListings — "You may also like" rail for the listing detail page.
 *
 * Renders a horizontal-scrolling row of mini listing cards keyed off the
 * /listings/{id}/similar endpoint (Meilisearch-ranked, category-bucketed).
 * Hidden entirely when the source listing has no related items, so the
 * detail page stays clean for one-of-a-kind goods.
 *
 * Design notes:
 *  - Each card is the smallest unit that still conveys photo + title +
 *    current bid + time-remaining hint. We do not reuse ScoreboardCard
 *    here because that component's vertical card is too tall for a
 *    horizontal rail; the lightweight card below is purpose-built.
 *  - Cards use Next.js <Link>, never <a>, per CLAUDE.md §13.
 *  - Photos use Next.js <Image> with fill; the rail is overflow-x:auto
 *    with snap points so touch flicking lands on a card edge.
 */

import { Clock } from 'lucide-react';
import Image from 'next/image';
import type { Route } from 'next';
import Link from 'next/link';

import { useSimilarListings } from '@/hooks/useListings';
import { canNextImageLoad, formatCents } from '@/lib/utils';
import type { Listing } from '@/types';

interface SimilarListingsProps {
  listingId: string;
  className?: string;
  /** Optional override of the rail title — defaults to "You may also like". */
  title?: string;
}

export function SimilarListings({
  listingId,
  className,
  title = 'You may also like',
}: SimilarListingsProps) {
  const { data, isLoading, isError } = useSimilarListings(listingId);

  // Hide entirely on error — this is a "nice to have" rail, not critical.
  if (isError) return null;

  const listings = data?.listings ?? [];

  if (!isLoading && listings.length === 0) return null;

  return (
    <section
      aria-label={title}
      className={`mt-10 ${className ?? ''}`}
      data-testid="similar-listings"
    >
      <header className="mb-3">
        <h2 className="text-lg font-semibold text-zinc-100">{title}</h2>
        <p className="text-xs text-zinc-500">
          Same category, ranked by relevance.
        </p>
      </header>

      <ul className="rail-scroll flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <li
                key={`similar-skeleton-${String(i)}`}
                className="glass animate-pulse w-44 shrink-0 snap-start rounded-lg border border-white/[0.06] p-2"
              >
                <div className="aspect-[4/3] w-full rounded-md bg-white/[0.06]" />
                <div className="mt-2 h-3 w-3/4 rounded bg-white/[0.06]" />
                <div className="mt-1 h-3 w-1/2 rounded bg-white/[0.06]" />
              </li>
            ))
          : listings.map((l) => <SimilarCard key={l.id} listing={l} />)}
      </ul>
    </section>
  );
}

function SimilarCard({ listing }: { listing: Listing }) {
  const rawPhoto = listing.photos[0]?.url;
  // Only hand next/image a src it can actually optimize; an unconfigured
  // remote host throws and crashes the page, so fall back to the placeholder.
  const photo = canNextImageLoad(rawPhoto) ? rawPhoto : undefined;
  const endsAt = listing.auction_ends_at;
  return (
    <li className="w-44 shrink-0 snap-start">
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
