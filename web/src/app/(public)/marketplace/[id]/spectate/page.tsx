'use client';

import { ArrowLeft, MapPin, Radio } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { AuctionTimer } from '@/components/jobs/AuctionTimer';
import { GradientMesh } from '@/components/landing/GradientMesh';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Sparkline } from '@/components/ui/sparkline';
import { useListing, useListingBids } from '@/hooks/useListings';
import { formatCents, formatRelativeTime } from '@/lib/utils';

export default function ListingSpectatePage() {
  const params = useParams<{ id: string }>();
  const listingId = params.id;

  const { data: listing, isLoading } = useListing(listingId);
  const { data: bidHistory } = useListingBids(listingId);

  if (isLoading || !listing) {
    return (
      <div className="dark relative min-h-screen overflow-y-auto bg-[#070b14] text-zinc-100">
        <GradientMesh />
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          {isLoading ? (
            <div className="space-y-4">
              <div className="h-10 w-2/3 animate-pulse rounded bg-white/5" />
              <div className="h-72 animate-pulse rounded-xl bg-white/5" />
            </div>
          ) : (
            <EmptyState title="Listing not found" />
          )}
        </div>
      </div>
    );
  }

  const sparklineSeries =
    bidHistory && bidHistory.bids.length > 0
      ? [listing.starting_price_cents, ...bidHistory.bids.map((b) => b.amount_cents).reverse()]
      : [listing.starting_price_cents, listing.current_bid_cents];

  return (
    <div className="dark relative min-h-screen overflow-y-auto bg-[#070b14] text-zinc-100">
      <GradientMesh />

      <div
        className="hero-vignette pointer-events-none absolute inset-0 z-[1]"
        aria-hidden="true"
      />

      {/* Sticky header */}
      <div className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#070b14]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-3">
            <Link
              href={`/marketplace/${listingId}` as Route}
              className="flex items-center gap-1.5 text-sm text-white/65 hover:text-white/85"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Listing</span>
            </Link>
            <div className="h-4 w-px bg-white/10" />
            <Badge className="gap-1 border-red-500/20 bg-red-500/10 text-xs text-red-400">
              <Radio className="h-3 w-3 animate-pulse" aria-hidden="true" />
              SPECTATE
            </Badge>
          </div>

          <div className="hidden items-center gap-3 text-sm md:flex">
            <h1 className="font-semibold text-white/90">{listing.title}</h1>
            {listing.pickup_zip ? (
              <div className="flex items-center gap-2 text-white/60">
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {listing.pickup_city ? `${listing.pickup_city}, ` : ''}
                  {listing.pickup_state ?? ''} {listing.pickup_zip}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Bloomberg-style grid */}
      <div className="relative z-[2] mx-auto grid max-w-[1400px] gap-4 px-4 py-6 sm:px-6 lg:grid-cols-3">
        {/* Big number panel */}
        <Card className="border-white/[0.06] bg-black/40 lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold tracking-[0.2em] text-emerald-400 uppercase">
              CURRENT BID
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-6xl font-bold text-emerald-400 tabular-nums sm:text-7xl">
              {formatCents(listing.current_bid_cents)}
            </p>
            <p className="mt-2 text-xs tracking-wider text-white/50 uppercase">
              Started at {formatCents(listing.starting_price_cents)} ·{' '}
              {String(listing.bidder_count)} bidders · {String(listing.bid_count)} bids
            </p>
            <Sparkline
              data={sparklineSeries}
              width={640}
              height={100}
              className="mt-4 text-emerald-400"
            />
          </CardContent>
        </Card>

        {/* Timer panel */}
        <Card className="border-white/[0.06] bg-black/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold tracking-[0.2em] text-amber-400 uppercase">
              TIME REMAINING
            </CardTitle>
          </CardHeader>
          <CardContent>
            {listing.auction_ends_at ? (
              <div className="flex justify-center py-4">
                <AuctionTimer auctionEndsAt={listing.auction_ends_at} />
              </div>
            ) : (
              <p className="text-sm text-white/50">Auction not started</p>
            )}
            {listing.snipe_extension_count > 0 ? (
              <p className="mt-2 text-center text-[11px] tracking-wider text-amber-400 uppercase">
                Extended ×{String(listing.snipe_extension_count)}
              </p>
            ) : null}
          </CardContent>
        </Card>

        {/* Activity feed */}
        <Card className="border-white/[0.06] bg-black/40 lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold tracking-[0.2em] text-cyan-400 uppercase">
              ORDER FLOW
            </CardTitle>
          </CardHeader>
          <CardContent>
            {bidHistory && bidHistory.bids.length > 0 ? (
              <ul className="divide-y divide-white/[0.06] font-mono text-sm">
                {bidHistory.bids.slice(0, 20).map((bid) => (
                  <li
                    key={bid.id}
                    className="grid grid-cols-3 gap-2 py-1.5 text-xs sm:grid-cols-4"
                  >
                    <span className="truncate text-white/70">{bid.bidder_display_name}</span>
                    <span className="text-emerald-300 tabular-nums">
                      {formatCents(bid.amount_cents)}
                    </span>
                    <span className="text-white/40">
                      {formatRelativeTime(new Date(bid.created_at))}
                    </span>
                    <span
                      className={
                        bid.is_winning ? 'hidden text-emerald-500 sm:inline' : 'hidden sm:inline'
                      }
                    >
                      {bid.is_winning ? 'LEADER' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-white/40">No bids yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
