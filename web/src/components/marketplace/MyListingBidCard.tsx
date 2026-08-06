'use client';

import { ExternalLink, Undo2 } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { memo, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ProgressiveImage } from '@/components/ui/ProgressiveImage';
import { useRetractListingBid } from '@/hooks/useListings';
import { LISTING_BID_RETRACT_WINDOW_MS } from '@/lib/listing-bid-retract';
import { formatCents, formatRelativeTime } from '@/lib/utils';
import { LISTING_STATUS } from '@/types';
import type { MyListingBid } from '@/types';

export { LISTING_BID_RETRACT_WINDOW_MS };

interface MyListingBidCardProps {
  entry: MyListingBid;
}

function remainingRetractMs(createdAt: string, nowMs: number): number {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return 0;
  return Math.max(0, created + LISTING_BID_RETRACT_WINDOW_MS - nowMs);
}

export const MyListingBidCard = memo(function MyListingBidCard({ entry }: MyListingBidCardProps) {
  const { bid, listing } = entry;
  const heroPhoto = listing.photos?.[0] ?? null;
  const retract = useRetractListingBid();

  // Tick every 250ms while a retract window may still be open so the button
  // disappears promptly when the 60s server window ends.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    setNowMs(Date.now());
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 250);
    return () => {
      window.clearInterval(id);
    };
  }, []);

  const isWinning = listing.is_user_winning || bid.is_winning;
  const status: 'winning' | 'outbid' | 'awarded' | 'lost' = isWinning
    ? listing.status === LISTING_STATUS.SOLD
      ? 'awarded'
      : 'winning'
    : listing.status === LISTING_STATUS.SOLD
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

  const remainingMs = nowMs === null ? 0 : remainingRetractMs(bid.created_at, nowMs);
  const canRetract =
    listing.status === LISTING_STATUS.ACTIVE && isWinning && remainingMs > 0;
  const remainingSec = Math.ceil(remainingMs / 1000);

  function handleRetract() {
    if (!canRetract || retract.isPending) return;
    retract.mutate({ listingId: listing.id, bidId: bid.id });
  }

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
          <span className="font-mono font-semibold text-zinc-100 tabular-nums tracking-tight">
            {formatCents(bid.amount_cents)}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-400">Current bid</span>
          <span
            className={
              isWinning
                ? 'font-mono font-semibold text-bid-winning tabular-nums tracking-tight'
                : 'font-mono font-semibold text-zinc-100 tabular-nums tracking-tight'
            }
          >
            {formatCents(listing.current_bid_cents)}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Link
            href={`/marketplace/${listing.id}` as Route}
            className="inline-flex min-h-[44px] items-center gap-1 text-xs text-[var(--brand-gold)] hover:underline"
          >
            View listing
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </Link>
          {canRetract ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-[44px] gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
              disabled={retract.isPending}
              onClick={handleRetract}
              aria-label={`Retract bid (${String(remainingSec)} seconds remaining)`}
            >
              <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
              {retract.isPending ? 'Retracting…' : `Retract (${String(remainingSec)}s)`}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
});
