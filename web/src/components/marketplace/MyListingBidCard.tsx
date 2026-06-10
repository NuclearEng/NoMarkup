'use client';

import { ExternalLink } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { memo } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ProgressiveImage } from '@/components/ui/ProgressiveImage';
import { formatCents, formatRelativeTime } from '@/lib/utils';
import type { MyListingBid } from '@/types';

interface MyListingBidCardProps {
  entry: MyListingBid;
}

export const MyListingBidCard = memo(function MyListingBidCard({ entry }: MyListingBidCardProps) {
  const { bid, listing } = entry;
  const heroPhoto = listing.photos[0] ?? null;

  const status: 'winning' | 'outbid' | 'awarded' | 'lost' = listing.is_user_winning
    ? listing.status === 'sold'
      ? 'awarded'
      : 'winning'
    : listing.status === 'sold'
      ? 'lost'
      : 'outbid';

  const badgeVariant: Parameters<typeof Badge>[0]['variant'] =
    status === 'winning' || status === 'awarded'
      ? 'active'
      : status === 'outbid'
        ? 'cancelled'
        : 'secondary';

  const badgeLabel: Record<typeof status, string> = {
    winning: 'Winning',
    awarded: 'Won',
    outbid: 'Outbid',
    lost: 'Lost',
  };

  return (
    <Card variant="glass">
      <CardHeader className="flex flex-row items-start gap-3 pb-2">
        {heroPhoto ? (
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md">
            <ProgressiveImage
              src={heroPhoto.url}
              alt={listing.title}
              blurHash={heroPhoto.blur_hash}
              className="absolute inset-0"
            />
          </div>
        ) : (
          <div className="h-16 w-16 shrink-0 rounded-md bg-zinc-800" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-1 text-sm font-semibold text-zinc-100">{listing.title}</h3>
          <p className="text-xs text-zinc-400">
            Bid {formatRelativeTime(new Date(bid.created_at))}
          </p>
        </div>
        <Badge variant={badgeVariant}>{badgeLabel[status]}</Badge>
      </CardHeader>
      <CardContent className="space-y-2 pt-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-400">Your bid</span>
          <span className="font-semibold text-zinc-100 tabular-nums">
            {formatCents(bid.amount_cents)}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-400">Current bid</span>
          <span
            className={
              listing.is_user_winning
                ? 'font-semibold text-emerald-400 tabular-nums'
                : 'font-semibold text-zinc-100 tabular-nums'
            }
          >
            {formatCents(listing.current_bid_cents)}
          </span>
        </div>
        <Link
          href={`/marketplace/${listing.id}` as Route}
          className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--brand-gold)] hover:underline"
        >
          View listing
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </Link>
      </CardContent>
    </Card>
  );
});
