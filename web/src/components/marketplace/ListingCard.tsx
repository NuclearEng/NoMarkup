'use client';

import { Clock, MapPin, Tag, Users } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { memo, useEffect, useMemo, useState } from 'react';

import { AuctionTimer } from '@/components/jobs/AuctionTimer';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ProgressiveImage } from '@/components/ui/ProgressiveImage';
import { cn, formatCents, formatRelativeTime } from '@/lib/utils';
import type { Listing } from '@/types';
import { LISTING_STATUS } from '@/types';

interface ListingCardProps {
  listing: Listing;
  /** When true, renders without a Link wrapper (used in seller's "My listings" rows) */
  asStaticCard?: boolean;
}

function getStatusVariant(
  status: string,
):
  | 'active'
  | 'draft'
  | 'completed'
  | 'cancelled'
  | 'secondary' {
  switch (status) {
    case LISTING_STATUS.ACTIVE:
      return 'active';
    case LISTING_STATUS.DRAFT:
      return 'draft';
    case LISTING_STATUS.SOLD:
      return 'completed';
    case LISTING_STATUS.CANCELLED:
    case LISTING_STATUS.EXPIRED:
      return 'cancelled';
    case LISTING_STATUS.ENDED:
      return 'secondary';
    default:
      return 'secondary';
  }
}

function getStatusBorderColor(status: string): string {
  switch (status) {
    case LISTING_STATUS.ACTIVE:
      return 'border-l-emerald-500 dark:border-l-emerald-400';
    case LISTING_STATUS.SOLD:
      return 'border-l-blue-500 dark:border-l-blue-400';
    case LISTING_STATUS.CANCELLED:
    case LISTING_STATUS.EXPIRED:
      return 'border-l-red-400 dark:border-l-red-500';
    case LISTING_STATUS.ENDED:
      return 'border-l-zinc-400 dark:border-l-zinc-500';
    default:
      return 'border-l-border';
  }
}

export const ListingCard = memo(function ListingCard({
  listing,
  asStaticCard = false,
}: ListingCardProps) {
  // `formatRelativeTime` reads `new Date()`, so the SSR-computed "posted" label
  // differs from the client's first render whenever the two land on opposite
  // sides of a minute/hour boundary → hydration mismatch (this card is
  // server-rendered inside the seeded marketplace grid). Gate it behind a
  // mounted flag — server + first client paint render nothing, then the real
  // relative time fills in post-mount. Mirrors JobCard.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const heroPhoto = useMemo(
    () => (listing.photos ?? []).find((p) => p.sort_order === 0) ?? listing.photos?.[0] ?? null,
    [listing.photos],
  );

  const distanceLabel = useMemo(() => {
    const km = listing.distance_km;
    if (km === null) return null;
    const miles = km * 0.621371;
    if (miles < 0.1) return 'less than 0.1 mi';
    if (miles < 10) return `${miles.toFixed(1)} mi`;
    return `${String(Math.round(miles))} mi`;
  }, [listing.distance_km]);

  const card = (
    <Card
      variant="glass"
      className={cn(
        'glass-interactive glass-highlight relative overflow-hidden border border-l-[3px] border-[var(--brand-gold)]/10',
        getStatusBorderColor(listing.status),
      )}
    >
      {/* Hero photo */}
      {heroPhoto ? (
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-zinc-900">
          <ProgressiveImage
            src={heroPhoto.url}
            alt={listing.title}
            blurHash={heroPhoto.blur_hash}
            className="absolute inset-0"
          />
          {listing.is_user_winning ? (
            <span
              className="absolute top-2 left-2 inline-flex items-center rounded-full bg-emerald-500/90 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-emerald-950 shadow-md"
              role="status"
            >
              You&rsquo;re winning
            </span>
          ) : null}
          {listing.was_outbid ? (
            <span
              className="absolute top-2 left-2 inline-flex items-center rounded-full bg-red-500/90 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-red-950 shadow-md"
              role="status"
            >
              Outbid
            </span>
          ) : null}
        </div>
      ) : (
        <div
          className="flex aspect-[4/3] w-full items-center justify-center bg-zinc-900/40 text-zinc-600"
          aria-label="No photo"
        >
          <Tag className="h-10 w-10" aria-hidden="true" />
        </div>
      )}

      <CardHeader className="relative z-[2] pb-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 text-base leading-snug font-semibold text-zinc-100">
            {listing.title}
          </h3>
          <Badge variant={getStatusVariant(listing.status)} className="shrink-0">
            {listing.status.replace(/_/g, ' ')}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="relative z-[2] space-y-3">
        {/* Category + pickup zip */}
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <Tag className="h-3.5 w-3.5 text-[var(--brand-gold)]/60" aria-hidden="true" />
          <span>{listing.category_name || 'Uncategorized'}</span>
        </div>

        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <MapPin className="h-3.5 w-3.5 text-[var(--brand-gold)]/60" aria-hidden="true" />
          <span className="truncate">
            {listing.pickup_city ? `${listing.pickup_city}, ` : ''}
            {listing.pickup_state ?? ''} {listing.pickup_zip}
          </span>
          {distanceLabel ? (
            <span className="text-xs text-zinc-500">· {distanceLabel}</span>
          ) : null}
        </div>

        {/* Bidder count + current bid */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-sm text-zinc-300">
            <Users className="h-3.5 w-3.5 text-[var(--brand-gold)]/60" aria-hidden="true" />
            <span className="font-medium">{String(listing.bidder_count)}</span>
            <span className="text-zinc-400">
              bidder{listing.bidder_count !== 1 ? 's' : ''}
            </span>
          </div>
          <span className="text-xs text-zinc-500">
            From {formatCents(listing.starting_price_cents)}
          </span>
        </div>

        {/* Current bid - large, gold accent */}
        <div className="flex items-baseline gap-1.5">
          <span className="text-xs font-medium text-zinc-500">Current bid:</span>
          <span
            className="text-lg font-bold text-[var(--brand-gold)] tabular-nums"
            style={{
              textShadow: '0 0 16px rgba(212,160,23,0.3), 0 0 32px rgba(212,160,23,0.1)',
            }}
          >
            {formatCents(listing.current_bid_cents)}
          </span>
        </div>

        {/* Auction timer + posted time */}
        <div className="pt-3">
          <div className="glass-divider mb-3" aria-hidden="true" />
          <div className="flex items-center justify-between">
            {listing.auction_ends_at ? (
              <AuctionTimer auctionEndsAt={listing.auction_ends_at} compact />
            ) : (
              <span className="flex items-center gap-1 text-xs text-zinc-500">
                <Clock className="h-3 w-3" aria-hidden="true" />
                Not started
              </span>
            )}
            <span className="text-xs text-zinc-500">
              {mounted ? formatRelativeTime(new Date(listing.created_at)) : null}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (asStaticCard) {
    return card;
  }

  return (
    <Link href={`/marketplace/${listing.id}` as Route} className="block">
      {card}
    </Link>
  );
});
